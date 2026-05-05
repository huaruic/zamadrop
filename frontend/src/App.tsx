import { useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  useConnect,
  useReconnect,
  useDisconnect,
  useSwitchChain,
  useWalletClient,
  type Connector,
} from "wagmi";
import { SEPOLIA_CHAIN_ID } from "./config";
import { PublicTab } from "./tabs/PublicTab";
import { AdminTab } from "./tabs/AdminTab";
import { RecipientTab } from "./tabs/RecipientTab";
import { AuditorTab } from "./tabs/AuditorTab";
import { useRoleInfo } from "./useRoleInfo";
import { LandingPage } from "./pages/LandingPage";

type AppRoute = "landing" | "campaign" | "admin" | "auditor" | "recipient";

function resolveRoute(pathname: string): AppRoute {
  if (pathname.startsWith("/campaign")) return "campaign";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/auditor")) return "auditor";
  if (pathname.startsWith("/recipient")) return "recipient";
  return "landing";
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(resolveRoute(window.location.pathname));
  const { address, isConnected } = useAccount();
  const { connect, connectors, error, isPending, variables } = useConnect();
  const { reconnect, isPending: reconnecting } = useReconnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const { roleLabels } = useRoleInfo(address);
  // 钱包连了但不在 Sepolia —— 写交易会上错链，必须先切回
  const wrongChain = isConnected && chainId !== SEPOLIA_CHAIN_ID;

  useEffect(() => {
    if (!isConnected || !address || walletClient || reconnecting) return;
    reconnect();
  }, [address, isConnected, reconnect, reconnecting, walletClient]);

  useEffect(() => {
    const onPopState = () => setRoute(resolveRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(next: AppRoute) {
    const pathname =
      next === "landing"
        ? "/"
        : next === "campaign"
          ? "/campaign"
          : next === "admin"
            ? "/admin"
            : next === "auditor"
              ? "/auditor"
              : "/recipient";
    window.history.pushState({}, "", pathname);
    setRoute(next);
  }

  if (route === "landing") {
    return <LandingPage onEnterCampaign={() => navigate("campaign")} />;
  }

  const pageTitle =
    route === "campaign"
      ? "Public Campaign"
      : route === "admin"
        ? "Admin Workspace"
        : route === "auditor"
          ? "Auditor Workspace"
          : "Recipient Workspace";

  const pageHint =
    route === "campaign"
      ? "Public campaign facts, wallet-gated eligibility, and private recipient claim flow."
      : route === "admin"
        ? "High-permission campaign operations. Hidden from the public entry."
        : route === "auditor"
          ? "Aggregate compliance view. No recipient-level amount exposure."
          : "Standalone recipient flow for focused testing and recovery paths.";

  return (
    <div className="min-h-screen flex flex-col bg-background text-text-primary">
      {wrongChain && (
        <div
          data-testid="wrong-chain-banner"
          className="flex items-center justify-between gap-4 border-b border-warning bg-warning-bg px-6 py-2 text-sm text-warning"
        >
          <span>
            钱包当前链 (chainId = {chainId}) 不是 Sepolia。写操作会失败或上错链。
          </span>
          <button
            onClick={() => switchChain({ chainId: SEPOLIA_CHAIN_ID })}
            disabled={switching}
            data-testid="switch-to-sepolia"
            className="whitespace-nowrap rounded border border-text-primary bg-text-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {switching ? "Switching…" : "切换到 Sepolia"}
          </button>
        </div>
      )}

      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between gap-6">
          <div className="min-w-0">
            <button
              onClick={() => navigate("landing")}
              className="text-left text-[34px] font-semibold tracking-[-0.06em] text-text-primary"
            >
              ZamaDrop
            </button>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-text-muted">
              {pageTitle}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">{pageHint}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate("campaign")}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  route === "campaign"
                    ? "border-text-primary bg-text-primary text-white"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Campaign
              </button>
              <button
                onClick={() => navigate("admin")}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  route === "admin"
                    ? "border-text-primary bg-text-primary text-white"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Admin
              </button>
              <button
                onClick={() => navigate("auditor")}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  route === "auditor"
                    ? "border-text-primary bg-text-primary text-white"
                    : "border-border bg-surface text-text-secondary"
                }`}
              >
                Auditor
              </button>
            </div>
            <WalletSession
              address={address}
              isConnected={isConnected}
              roleLabels={roleLabels}
              connectors={connectors as readonly Connector[]}
              connect={connect}
              disconnect={disconnect}
              error={error}
              isPending={isPending}
              variables={variables}
            />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1440px] px-6 py-8">
          {route === "campaign" && <PublicTab />}
          {route === "admin" && <AdminTab />}
          {route === "auditor" && <AuditorTab />}
          {route === "recipient" && <RecipientTab />}
        </div>
      </main>

      <footer className="border-t border-border bg-surface px-6 py-4 text-xs text-text-muted">
        <div className="mx-auto flex w-full max-w-[1440px] justify-between gap-4">
          <div>Sepolia testnet · ZamaDrop confidential distribution</div>
          <a
            href={`https://sepolia.etherscan.io/address/0x30Af9a636B0284338B5D6CB1DE5DaE3407B6Ed93`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent"
          >
            Contract on Etherscan ↗
          </a>
        </div>
      </footer>
    </div>
  );
}

function WalletSession({
  address,
  isConnected,
  roleLabels,
  connectors,
  connect,
  disconnect,
  error,
  isPending,
  variables,
}: {
  address?: `0x${string}`;
  isConnected: boolean;
  roleLabels: string[];
  connectors: readonly Connector[];
  connect: ReturnType<typeof useConnect>["connect"];
  disconnect: ReturnType<typeof useDisconnect>["disconnect"];
  error: ReturnType<typeof useConnect>["error"];
  isPending: boolean;
  variables: ReturnType<typeof useConnect>["variables"];
}) {
  return (
    <div>
      {isConnected && address ? (
        <div className="flex items-center gap-3">
          <div>
            <div className="text-right" data-testid="wallet-session">
              <div className="font-mono text-xs text-text-primary" data-testid="connected-address">
                {address.slice(0, 6)}…{address.slice(-4)}
              </div>
              <div className="text-[10px] text-text-muted" data-testid="connected-role">
                {roleLabels.length > 0 ? roleLabels.join(" · ") : "Connected"}
              </div>
            </div>
          </div>
          <button
            onClick={() => disconnect()}
            data-testid="disconnect-wallet"
            className="rounded border border-text-primary bg-text-primary px-3 py-1.5 text-xs text-white"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-end gap-2">
          {connectors.length === 0 ? (
            <span className="text-xs text-red-700">未检测到浏览器钱包扩展</span>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {connectors.map((c) => {
                const pending =
                  isPending &&
                  (variables?.connector as Connector | undefined)?.uid === c.uid;
                return (
                  <button
                    key={c.uid}
                    onClick={() => connect({ connector: c })}
                    disabled={isPending}
                    data-testid={`connect-wallet-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    className="rounded border border-text-primary bg-text-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {pending ? "Connecting…" : `Connect ${c.name}`}
                  </button>
                );
              })}
            </div>
          )}
          {error ? (
            <span className="max-w-xs truncate text-[11px] text-red-700" title={error.message}>
              {error.message}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
