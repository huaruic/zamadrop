import { useAccount, useReadContract } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  describeStage,
  useUserDecryptEuint64,
} from "@/hooks/useUserDecryptEuint64";
import { formatTokenAmount } from "@/hooks/useTokenMeta";

interface AggregateCardProps {
  campaignAddress: `0x${string}`;
  declaredTotal: bigint | undefined;
  decimals: number;
  symbol: string | undefined;
}

/** Section 1 — read the encrypted aggregate handle, decrypt via KMS, render
 * the plaintext total + percent-of-declared comparison.
 *
 * SECURITY: only mounted in state C (connected as auditor). The view
 * function `requestClaimedTotalForAuditor()` checks `msg.sender == auditor`,
 * so we MUST forward the connected wallet via `account` — otherwise wagmi
 * sends `from: 0x0` and the call reverts NotAuditor. */
export function AggregateCard({
  campaignAddress,
  declaredTotal,
  decimals,
  symbol,
}: AggregateCardProps) {
  const { address: walletAddress } = useAccount();
  const {
    data: handle,
    isLoading: handleLoading,
    error: handleError,
  } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "requestClaimedTotalForAuditor",
    account: walletAddress,
    query: { enabled: !!walletAddress },
  });

  const { decrypt, data, error, isPending, stage } = useUserDecryptEuint64();

  const handleHex = handle as `0x${string}` | undefined;

  const onDecrypt = () => {
    if (!handleHex) return;
    decrypt({ handle: handleHex, contractAddress: campaignAddress });
  };

  const percent =
    data !== undefined && declaredTotal && declaredTotal > 0n
      ? (Number((data * 10000n) / declaredTotal) / 100).toFixed(1)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claimed total · aggregate</CardTitle>
        <CardDescription>
          Sum of all claimed allocations. Encrypted on-chain; only auditor can
          decrypt.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Ciphertext handle
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-foreground">
              {handleHex ? shortHex(handleHex) : handleLoading ? "Loading…" : "—"}
            </span>
            <Badge variant="cipher">Encrypted</Badge>
          </div>
        </div>

        {data !== undefined && (
          <div className="space-y-2 rounded-md border border-cipher/30 bg-cipher/5 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Decrypted total
            </div>
            <div className="font-mono text-3xl font-semibold tracking-tight">
              {formatTokenAmount(data, decimals, symbol)}
            </div>
            {percent !== null && (
              <div className="font-mono text-xs text-muted-foreground">
                {percent}% of declared total claimed
              </div>
            )}
            <p className="pt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
              Visible only to you. KMS signed this decryption — not derivable
              from individual allocations.
            </p>
          </div>
        )}

        {handleError && (
          <Alert variant="destructive">
            <AlertTitle>Cannot read aggregate handle</AlertTitle>
            <AlertDescription>{handleError.message}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Decryption failed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Button onClick={onDecrypt} disabled={!handleHex || isPending}>
            {isPending ? "Decrypting…" : "Decrypt aggregate"}
          </Button>
          {isPending && (
            <p className="font-mono text-[11px] italic text-muted-foreground">
              {describeStage(stage)}
            </p>
          )}
        </div>
      </CardContent>

      <CardFooter>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          ◢ ACL grants `_claimedTotal` to auditor only
        </p>
      </CardFooter>
    </Card>
  );
}

function shortHex(hex: `0x${string}`): string {
  return `${hex.slice(0, 10)}…${hex.slice(-4)}`;
}
