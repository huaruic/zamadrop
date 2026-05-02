import { useReadContract } from "wagmi";
import { CAMPAIGN_ABI } from "../abis";
import { CONTRACTS, ETHERSCAN_BASE } from "../config";

export function PublicTab() {
  const { data: declaredTotal } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "declaredTotal",
  });
  const { data: recipientCount } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "recipientCount",
  });
  const { data: finalized } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "finalized",
  });
  const { data: admin } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "admin",
  });
  const { data: auditor } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "auditor",
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Public Dashboard</h2>
        <p className="text-sm text-zinc-400 mt-1">
          任何人可见。Campaign 总量、人数、状态完全透明，但**单笔 allocation 金额对所有人保密**。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Declared Total" value={declaredTotal?.toString() ?? "—"} suffix="ZDT" />
        <Stat label="Recipients" value={recipientCount?.toString() ?? "—"} />
        <Stat label="Status" value={finalized === undefined ? "—" : finalized ? "Claiming" : "Setup"} />
        <Stat label="Token" value="ZDT" suffix={shortAddr(CONTRACTS.token)} />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
        <Row label="Admin" value={admin as string | undefined} link />
        <Row label="Auditor" value={auditor as string | undefined} link />
        <Row label="Campaign 合约" value={CONTRACTS.campaign} link />
      </div>

      <div className="rounded-lg border border-purple-900/50 bg-purple-950/20 p-4 text-sm">
        <div className="font-medium text-purple-300">隐私保证</div>
        <div className="text-zinc-400 mt-1 leading-relaxed">
          所有受益人的 allocation 以 FHE 密文形式存储在链上。
          finalize 时合约在密文状态下验证「所有 allocation 之和 = declaredTotal」，
          整个过程 <span className="text-purple-300">无任何个人金额被解密</span>。
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">
        {value}
        {suffix && <span className="ml-2 text-sm text-zinc-400 font-normal">{suffix}</span>}
      </div>
    </div>
  );
}

function Row({ label, value, link }: { label: string; value?: string; link?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      {value ? (
        link ? (
          <a
            href={`${ETHERSCAN_BASE}/address/${value}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-purple-400 hover:text-purple-300"
          >
            {shortAddr(value)} ↗
          </a>
        ) : (
          <span className="font-mono text-zinc-300">{value}</span>
        )
      ) : (
        <span className="text-zinc-600">—</span>
      )}
    </div>
  );
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
