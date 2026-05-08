import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { Button } from "@/components/ui/button";
import { SEPOLIA_CHAIN_ID } from "@/config";

import {
  clearSession,
  getSessionToken,
  siweLogin,
} from "./siwe-client";

/** SIWE sign-in / sign-out button.
 *
 * Renders one of three states:
 *   - Disconnected wallet      → disabled "Sign in"
 *   - Connected, no session    → "Sign in (no gas)" button
 *   - Connected, has session   → "Sign out" button (clears localStorage)
 *
 * `onSessionChange` lets the parent (Home) refresh after login/logout. */
interface SiweButtonProps {
  onSessionChange?: (hasSession: boolean) => void;
  size?: "sm" | "default";
}

export function SiweButton({
  onSessionChange,
  size = "sm",
}: SiweButtonProps) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We can't observe localStorage reactively across components without a
  // store. A cheap re-render trigger: bump a counter on every action.
  const [, force] = useState(0);
  const hasSession = !!getSessionToken();

  const handleSignIn = async () => {
    if (!isConnected || !address) return;
    setError(null);
    setBusy(true);
    try {
      await siweLogin(address, signMessageAsync, SEPOLIA_CHAIN_ID);
      force((n) => n + 1);
      onSessionChange?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    clearSession();
    force((n) => n + 1);
    onSessionChange?.(false);
  };

  if (!isConnected) {
    return (
      <Button size={size} variant="outline" disabled>
        Sign in
      </Button>
    );
  }

  if (hasSession) {
    return (
      <Button size={size} variant="outline" onClick={handleSignOut}>
        Sign out
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size={size}
        onClick={handleSignIn}
        disabled={busy}
        title="Signs an EIP-4361 message — no transaction, no gas."
      >
        {busy ? "Signing…" : "Sign in (no gas)"}
      </Button>
      {error && (
        <span className="font-mono text-[10px] text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
