import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import type { Connector } from "wagmi";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TopBar() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Log discovered connectors so users debugging "Connecting…" stuck can see
  // which providers are visible (EIP-6963 multi-injected discovery surfaces
  // every installed wallet — picking [0] blindly hits whichever extension
  // hijacked window.ethereum first).
  useEffect(() => {
    if (connectors.length === 0) return;
    console.log(
      "[ZamaDrop] connectors:",
      connectors.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    );
  }, [connectors]);

  const handleConnect = (connector: Connector) => {
    setPickerOpen(false);
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
          ) : connectors.length === 0 ? (
            <Button size="sm" disabled>
              No wallet detected
            </Button>
          ) : connectors.length === 1 ? (
            <Button size="sm" onClick={() => handleConnect(connectors[0])}>
              Connect wallet
            </Button>
          ) : (
            <ConnectorPicker
              connectors={connectors}
              open={pickerOpen}
              setOpen={setPickerOpen}
              onPick={handleConnect}
            />
          )}
        </div>
      </div>
      {error && (
        <div className="border-t border-destructive/40 bg-destructive/10 px-6 py-1 text-center font-mono text-[11px] text-destructive">
          {error.message}
        </div>
      )}
    </header>
  );
}

interface ConnectorPickerProps {
  connectors: readonly Connector[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onPick: (connector: Connector) => void;
}

function ConnectorPicker({
  connectors,
  open,
  setOpen,
  onPick,
}: ConnectorPickerProps) {
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen(!open)}>
        Connect wallet ▾
      </Button>
      {open && (
        <>
          {/* click-outside catcher */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-50 mt-2 min-w-[240px] rounded-md border border-border bg-card p-1 shadow-card">
            {connectors.map((c) => (
              <button
                key={c.uid}
                type="button"
                onClick={() => onPick(c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-mono text-xs",
                  "hover:bg-secondary focus:bg-secondary focus:outline-none",
                )}
              >
                {c.icon && (
                  <img
                    src={c.icon}
                    alt=""
                    className="size-4 rounded-sm"
                    aria-hidden
                  />
                )}
                <span className="flex-1 truncate">{c.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {c.type}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function shortAddr(addr?: `0x${string}`) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
