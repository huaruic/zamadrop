/**
 * FHE 客户端工具函数：基于 @zama-fhe/relayer-sdk
 *
 * 关键操作：
 * - encryptUint64：加密金额（admin setAllocation 用）
 * - userDecryptEuint64：用户重加密解密（recipient 看自己金额、auditor 看聚合）
 * - publicDecryptEbool / publicDecryptEuint64：公开解密（finalize check / claim 后金额）
 */
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { SEPOLIA_CHAIN_ID } from "./config";

let _instancePromise: Promise<FhevmInstance> | null = null;

/** 初始化（懒加载，全局单例） */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (_instancePromise) return _instancePromise;
  _instancePromise = (async () => {
    await initSDK(); // 加载 WASM
    // SepoliaConfig 缺少 network 字段（让用户传入 ethers/viem 的 provider）
    // window.ethereum 是 MetaMask/wallet 注入的 EIP-1193 provider
    const network = (window as any).ethereum;
    if (!network) {
      throw new Error("No EIP-1193 provider found. Please install MetaMask.");
    }
    return createInstance({ ...SepoliaConfig, network });
  })();
  return _instancePromise;
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

/**
 * 用户重加密解密 euint64：用户用自己的临时密钥解密 handle
 * 服务端不经手明文，整个解密流程在浏览器完成
 */
export async function userDecryptEuint64(
  handle: `0x${string}`,
  contractAddress: `0x${string}`,
  signer: { signTypedData: (params: any) => Promise<string>; address: `0x${string}` },
): Promise<bigint> {
  const instance = await getFhevmInstance();
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

  const signature: string = await signer.signTypedData({
    domain: eip712.domain,
    types: { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message,
  });

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

// 防止 SEPOLIA_CHAIN_ID 未使用警告（保留备用）
export { SEPOLIA_CHAIN_ID };
