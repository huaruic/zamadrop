import { Link } from "react-router-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasWalletProvider, openMetaMaskInstall } from "@/lib/wallet-connect";
import { isUserRejectedError } from "@/lib/wallet-error";

export function TopBar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const connector = connectors[0];
  const connectFeedback = (() => {
    if (!error || isUserRejectedError(error)) return null;
    const message = error.message ?? "Wallet connection failed.";
    if (
      message.includes("No injected provider found") ||
      message.includes("Provider not found") ||
      message.includes("Connector not found")
    ) {
      return {
        tone: "neutral" as const,
        message:
          "MetaMask was not detected. Install it, then reopen this page or use a Web3 wallet browser on mobile.",
      };
    }
    return { tone: "error" as const, message };
  })();

  const handleConnect = async () => {
    if (!connector) {
      openMetaMaskInstall();
      return;
    }
    if (!(await hasWalletProvider(connector))) {
      openMetaMaskInstall();
      return;
    }
    connect({ connector });
  };

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <a
          href="/"
          className="flex items-center gap-2 font-mono text-sm font-semibold tracking-tight text-foreground"
        >
          <span className="size-2 rounded-full bg-primary animate-flicker" />
          ZamaDrop
        </a>

        <div className="flex items-center gap-3">
          <Badge variant="outline">⌗ Sepolia</Badge>

          {isConnected && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/wizard">+ Deploy</Link>
            </Button>
          )}

          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnect()}
              title="Click to disconnect"
            >
              {shortAddr(address)}
            </Button>
          ) : isPending ? (
            <div className="flex items-center gap-2">
              <Button size="sm" disabled>
                Connecting…
              </Button>
              <button
                type="button"
                onClick={() => reset()}
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={() => void handleConnect()}
            >
              Connect Wallet
            </Button>
          )}
        </div>
      </div>
      {connectFeedback && (
        <div
          className={
            connectFeedback.tone === "error"
              ? "border-t border-destructive/40 bg-destructive/10 px-6 py-1 text-center font-mono text-[11px] text-destructive"
              : "border-t border-border/60 bg-surface px-6 py-1 text-center font-mono text-[11px] text-muted-foreground"
          }
        >
          {connectFeedback.message}
        </div>
      )}
    </header>
  );
}

function shortAddr(addr?: `0x${string}`) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
