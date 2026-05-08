import { useState } from "react";
import { useReadContract, useWalletClient } from "wagmi";

import { ERC20_ABI } from "@/abis";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ETHERSCAN_BASE } from "@/config";
import { formatTokenAmount } from "@/hooks/useTokenMeta";

interface BalancePanelProps {
  tokenAddress?: `0x${string}`;
  account: `0x${string}`;
  decimals: number;
  symbol?: string;
  /** True once the recipient's settlement transaction has confirmed
   * on-chain. Gates the "Add token to wallet" affordance — there is no
   * point asking a recipient to add a token they have not yet received. */
  transferred?: boolean;
}

type WatchAssetState =
  | { kind: "idle" }
  | { kind: "adding" }
  | { kind: "added" }
  | { kind: "rejected" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

/** Live ERC-20 balance for the connected recipient. Polls every 8s so it
 * picks up the `executeTransfer` settlement without a manual refresh.
 *
 * After settlement, also offers to register the token in the connected
 * wallet via EIP-747 (`wallet_watchAsset`). Most wallets that don't auto-
 * discover arbitrary ERC-20s (custom airdrop tokens, brand-new project
 * tokens) need this — otherwise the recipient sees "300 ZDT" in the dApp
 * but a literally empty wallet UI. Generic "Add token to wallet" wording
 * (not "Add to MetaMask") to respect EIP-6963 multi-wallet reality. */
export function BalancePanel({
  tokenAddress,
  account,
  decimals,
  symbol,
  transferred,
}: BalancePanelProps) {
  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
    query: {
      enabled: !!tokenAddress,
      refetchInterval: 8000,
    },
  });
  const { data: walletClient } = useWalletClient();

  const [watchState, setWatchState] = useState<WatchAssetState>({ kind: "idle" });

  // Metadata must be loaded before we can pass a meaningful payload to
  // wallet_watchAsset. Symbol is the riskiest piece — coming from the
  // contract, it can be whatever the deployer wrote (Codex review
  // explicitly flagged this), so trust it for display only and accept
  // wallets may show their own version.
  const metadataReady =
    !!tokenAddress && !!symbol && typeof decimals === "number";

  async function handleAddToWallet() {
    if (!walletClient || !tokenAddress || !symbol) return;
    setWatchState({ kind: "adding" });
    try {
      // viem WalletClient.request handles the underlying provider routing
      // for the wagmi-connected wallet, which avoids the multi-injected
      // `window.ethereum` ambiguity (a different extension may have
      // hijacked the global). Some viem versions narrow the request type;
      // the explicit cast keeps both happy.
      const ok = (await (
        walletClient as unknown as {
          request: (args: {
            method: "wallet_watchAsset";
            params: {
              type: "ERC20";
              options: {
                address: `0x${string}`;
                symbol: string;
                decimals: number;
              };
            };
          }) => Promise<boolean>;
        }
      ).request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: {
            address: tokenAddress,
            symbol,
            decimals,
          },
        },
      })) as boolean;
      setWatchState({ kind: ok ? "added" : "rejected" });
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      // EIP-1193 4001 = user rejected; -32601 / 4200 = method not
      // supported. Smart-contract wallets and a few legacy injectors
      // surface the latter — degrade gracefully instead of red-flagging.
      if (e.code === 4001) {
        setWatchState({ kind: "rejected" });
      } else if (e.code === -32601 || e.code === 4200) {
        setWatchState({ kind: "unsupported" });
      } else {
        setWatchState({
          kind: "error",
          message: e.message ?? String(err),
        });
      }
    }
  }

  // Etherscan fallback works for any wallet, including unsupported ones
  // and recipients who would rather verify the token externally before
  // approving any wallet prompt.
  const explorerUrl = tokenAddress
    ? `${ETHERSCAN_BASE}/token/${tokenAddress}?a=${account}`
    : null;

  // Show the wallet-side affordance only after settlement; the button is
  // meaningless before there are tokens to surface. Not a security gate —
  // just UX hygiene.
  const showWalletAffordance = transferred && metadataReady;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your token balance</CardTitle>
        <CardDescription>
          Refreshes every ~8 seconds. After settlement, expect the new balance
          to appear within one block.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="font-mono text-3xl font-semibold tracking-tight">
          {formatTokenAmount(balance as bigint | undefined, decimals, symbol)}
        </div>

        {showWalletAffordance && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddToWallet}
                disabled={watchState.kind === "adding"}
              >
                {watchState.kind === "adding"
                  ? "Asking wallet…"
                  : watchState.kind === "added"
                    ? "Added ✓"
                    : "Add token to wallet"}
              </Button>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                >
                  View on Etherscan ↗
                </a>
              )}
            </div>
            {watchState.kind === "rejected" && (
              <p className="font-mono text-[11px] text-muted-foreground">
                Token not added. You can run "Add token to wallet" again any
                time, or import {symbol ?? "the token"} manually using the
                Etherscan link.
              </p>
            )}
            {watchState.kind === "unsupported" && (
              <p className="font-mono text-[11px] text-muted-foreground">
                Your wallet does not support adding tokens automatically. Use
                the Etherscan link to verify the contract, then import it by
                hand from your wallet's UI.
              </p>
            )}
            {watchState.kind === "error" && (
              <p className="font-mono text-[11px] text-destructive">
                Couldn't add token: {watchState.message}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
