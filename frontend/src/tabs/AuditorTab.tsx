import { useState } from "react";
import { useAccount, useReadContract, useWalletClient } from "wagmi";
import { CAMPAIGN_ABI } from "../abis";
import { CONTRACTS, AUDITOR_ADDRESS } from "../config";
import { userDecryptEuint64 } from "../fhevm";

export function AuditorTab() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  const isAuditor =
    !!address && address.toLowerCase() === AUDITOR_ADDRESS.toLowerCase();

  // 仅 auditor 钱包查询不会 revert，其他钱包跳过
  const { data: handle, isLoading: handleLoading } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "requestClaimedTotalForAuditor",
    account: address,
    query: { enabled: isAuditor },
  });

  const [decrypting, setDecrypting] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [aggregate, setAggregate] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecrypt() {
    if (!handle || !walletClient || !address) return;
    setError(null);
    setDecrypting(true);
    try {
      setStage("Awaiting signature...");
      const signer = {
        address,
        signTypedData: async (params: any) => {
          // 第一次 signTypedData 时把 stage 切到 "Decrypting via KMS..."
          const sig = await walletClient.signTypedData(params);
          setStage("Decrypting via KMS...");
          return sig;
        },
      };
      const value = await userDecryptEuint64(
        handle as `0x${string}`,
        CONTRACTS.campaign,
        signer,
      );
      setAggregate(value);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setDecrypting(false);
      setStage("");
    }
  }

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
          Connect with auditor wallet to use this view.
        </div>
      </div>
    );
  }

  if (!isAuditor) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-sm text-zinc-400">
          Connect with auditor wallet to use this view.
          <div className="mt-2 text-xs text-zinc-500">
            Expected:{" "}
            <span className="font-mono text-zinc-400">
              {AUDITOR_ADDRESS}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      {/* 聚合统计卡片 */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-white">
            Claimed Total (Aggregate)
          </h3>
          <span className="text-[10px] uppercase tracking-wider text-purple-400">
            Encrypted on-chain
          </span>
        </div>

        <div className="text-xs text-zinc-500">
          Ciphertext handle
        </div>
        <div className="font-mono text-xs text-zinc-400 break-all">
          {handleLoading
            ? "loading..."
            : handle
              ? shortHandle(handle as string)
              : "—"}
        </div>

        {aggregate !== null ? (
          <div className="pt-2">
            <div className="text-xs text-zinc-500 mb-1">Decrypted aggregate</div>
            <div className="text-5xl font-bold text-white">
              {aggregate.toString()}
              <span className="ml-3 text-xl text-purple-400 font-normal">
                ZDT
              </span>
            </div>
          </div>
        ) : (
          <button
            onClick={handleDecrypt}
            disabled={!handle || decrypting}
            className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium text-sm"
          >
            {decrypting ? stage || "Working..." : "Decrypt aggregate"}
          </button>
        )}

        {error && (
          <div className="text-xs text-red-400 break-all">{error}</div>
        )}
      </div>

      {/* Programmable Compliance 说明 */}
      <div className="rounded-lg border border-purple-900/50 bg-purple-950/20 p-4 text-sm">
        <div className="font-medium text-purple-300">
          Programmable Compliance
        </div>
        <div className="text-zinc-400 mt-1 leading-relaxed">
          Auditor 能解密 <span className="text-purple-300">claimedTotal</span>{" "}
          这个聚合值，但<span className="text-purple-300 font-medium">无法</span>
          解密任何个人 allocation。这是 FHE 让监管者拿到所需统计数字、
          同时不破坏个人隐私的体现。
        </div>
      </div>

      {/* Limitations */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
        <div className="font-medium text-zinc-300">Auditor 看不到</div>
        <ul className="text-zinc-400 mt-2 space-y-1 list-disc list-inside">
          <li>任何受益人的个人 allocation 金额</li>
          <li>未 claim 的 allocation 总额</li>
          <li>个人是否已经 claim 之外的任何身份关联信息</li>
        </ul>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-white">Auditor View</h2>
      <p className="text-sm text-zinc-400 mt-1">
        审计员视图：通过 user re-encryption 解密 claimedTotal 的聚合密文，
        证明可编程合规——监管能拿到聚合数字，但拿不到任何个人金额。
      </p>
    </div>
  );
}

function shortHandle(h: string) {
  if (h.length <= 22) return h;
  return `${h.slice(0, 12)}…${h.slice(-8)}`;
}
