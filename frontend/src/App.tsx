import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { ADMIN_ADDRESS, AUDITOR_ADDRESS } from "./config";
import { PublicTab } from "./tabs/PublicTab";
import { AdminTab } from "./tabs/AdminTab";
import { RecipientTab } from "./tabs/RecipientTab";
import { AuditorTab } from "./tabs/AuditorTab";

type TabKey = "public" | "admin" | "recipient" | "auditor";

const TABS: { key: TabKey; label: string; description: string }[] = [
  { key: "public", label: "Public", description: "聚合可见，无个人金额" },
  { key: "admin", label: "Admin", description: "设置 allocation / Finalize" },
  { key: "recipient", label: "Recipient", description: "查看自己金额并 Claim" },
  { key: "auditor", label: "Auditor", description: "聚合统计，可编程合规" },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("public");
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const isAdmin = address?.toLowerCase() === ADMIN_ADDRESS.toLowerCase();
  const isAuditor = address?.toLowerCase() === AUDITOR_ADDRESS.toLowerCase();

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶部 */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">ZamaDrop</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Private allocations. Public accountability.
          </p>
        </div>
        <div>
          {isConnected && address ? (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-mono text-xs text-zinc-300">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {isAdmin && "Admin"}
                  {isAuditor && !isAdmin && "Auditor"}
                  {!isAdmin && !isAuditor && "Recipient/Public"}
                </div>
              </div>
              <button
                onClick={() => disconnect()}
                className="px-3 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-medium"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Tab 导航 */}
      <nav className="border-b border-zinc-800 px-6 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "px-4 py-3 text-sm font-medium border-b-2 transition " +
              (tab === t.key
                ? "border-purple-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200")
            }
          >
            {t.label}
            <span className="ml-2 text-[10px] text-zinc-500 font-normal">
              {t.description}
            </span>
          </button>
        ))}
      </nav>

      {/* 内容 */}
      <main className="flex-1 px-6 py-8 max-w-5xl w-full mx-auto">
        {tab === "public" && <PublicTab />}
        {tab === "admin" && <AdminTab />}
        {tab === "recipient" && <RecipientTab />}
        {tab === "auditor" && <AuditorTab />}
      </main>

      <footer className="border-t border-zinc-800 px-6 py-4 text-xs text-zinc-500 flex justify-between">
        <div>Sepolia testnet · Zama Protocol Bounty</div>
        <a
          href={`https://sepolia.etherscan.io/address/0x30Af9a636B0284338B5D6CB1DE5DaE3407B6Ed93`}
          target="_blank"
          rel="noreferrer"
          className="hover:text-purple-400"
        >
          Contract on Etherscan ↗
        </a>
      </footer>
    </div>
  );
}
