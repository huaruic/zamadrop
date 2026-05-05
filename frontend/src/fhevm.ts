/**
 * FHE 客户端工具函数：基于 @zama-fhe/relayer-sdk
 *
 * 关键操作：
 * - encryptUint64：加密金额（admin setAllocation 用）
 * - userDecryptEuint64：用户重加密解密（recipient 看自己金额、auditor 看聚合）
 * - publicDecryptEbool / publicDecryptEuint64：公开解密（finalize check / claim 后金额）
 */
// 注意：SDK runtime 用 dynamic import 拉，不在 top-level import，
// 否则会被打进首屏 chunk（~1MB JS）。Public tab 不应触发 SDK 加载
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { SEPOLIA_RPC } from "./config";

let _instancePromise: Promise<FhevmInstance> | null = null;

/**
 * 初始化（懒加载，全局单例）
 *
 * createInstance 内部要从链上读 input verifier / KMS 等合约地址。这一步是只读的，
 * 不需要钱包签名。直接传 RPC URL 让 SDK 用独立 ethers provider 直连 Sepolia，
 * 绕过 window.ethereum —— 否则被钱包聚合扩展（OKX/OneKey 的 evmAsk）劫持后会崩
 */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (_instancePromise) return _instancePromise;
  const promise = (async () => {
    // dynamic import：SDK chunk 仅在此调用时下载
    const { initSDK, createInstance, SepoliaConfig } = await import(
      "@zama-fhe/relayer-sdk/web"
    );
    await initSDK(); // 加载 WASM
    return createInstance({ ...SepoliaConfig, network: SEPOLIA_RPC });
  })();
  _instancePromise = promise;
  // reject 时清空，让下次调用能重试（否则用户被钉死在 rejected promise）
  promise.catch(() => {
    if (_instancePromise === promise) _instancePromise = null;
  });
  return promise;
}

/** Admin 加密 allocation 金额 */
export async function encryptUint64(
  contractAddress: `0x${string}`,
  userAddress: `0x${string}`,
  value: bigint,
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const instance = await getFhevmInstance();
  const buffer = instance.createEncryptedInput(contractAddress, userAddress);
  buffer.add64(value);
  const ciphertexts = await buffer.encrypt();
  return {
    handle: toHex(ciphertexts.handles[0]),
    proof: toHex(ciphertexts.inputProof),
  };
}

/** userDecryptEuint64 的内部阶段，UI 用来显示进度 */
export type UserDecryptStage = "sdk" | "keypair" | "signing" | "kms";

/**
 * 用户重加密解密 euint64：用户用自己的临时密钥解密 handle
 * 服务端不经手明文，整个解密流程在浏览器完成
 *
 * onStage 回调让调用方能反馈当前阶段，避免 UI 在 SDK 加载阶段显示"awaiting signature"
 */
export async function userDecryptEuint64(
  handle: `0x${string}`,
  contractAddress: `0x${string}`,
  signer: { signTypedData: (params: any) => Promise<string>; address: `0x${string}` },
  onStage?: (stage: UserDecryptStage) => void,
): Promise<bigint> {
  onStage?.("sdk");
  const instance = await getFhevmInstance();

  onStage?.("keypair");
  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const contractAddresses = [contractAddress];

  const eip712 = instance.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimestamp,
    durationDays,
  );

  onStage?.("signing");
  const signature: string = await signer.signTypedData({
    domain: eip712.domain,
    types: { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message,
  });

  onStage?.("kms");
  const result: any = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    signer.address,
    startTimestamp,
    durationDays,
  );

  return result[handle] as bigint;
}

/** 公开解密 ebool（finalize 总量校验结果） */
export async function publicDecryptEbool(handle: `0x${string}`): Promise<boolean> {
  const instance = await getFhevmInstance();
  const result: any = await instance.publicDecrypt([handle]);
  // result 可能是 { clearValues: Record<handle, value>, ... } 或直接 Record
  if ("clearValues" in result) return result.clearValues[handle] as boolean;
  return result[handle] as boolean;
}

/** 公开解密 euint64（claim 后的 allocation 金额） */
export async function publicDecryptEuint64(handle: `0x${string}`): Promise<bigint> {
  const instance = await getFhevmInstance();
  const result: any = await instance.publicDecrypt([handle]);
  if ("clearValues" in result) return result.clearValues[handle] as bigint;
  return result[handle] as bigint;
}

// ─── helpers ──────────────────────────────────────────────────────
function toHex(v: Uint8Array | string): `0x${string}` {
  if (typeof v === "string") {
    return (v.startsWith("0x") ? v : `0x${v}`) as `0x${string}`;
  }
  const hex = Array.from(v)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}` as `0x${string}`;
}

