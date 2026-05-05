import { useReadContract } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  describeStage,
  useUserDecryptEuint64,
} from "@/hooks/useUserDecryptEuint64";
import { formatTokenAmount } from "@/hooks/useTokenMeta";

import { shortHandle } from "./shorten";

interface AllocationCardProps {
  campaignAddress: `0x${string}`;
  account: `0x${string}`;
  decimals: number;
  symbol?: string;
  /** When true, settlement has already happened — the amount is now public via
   * the ERC-20 Transfer event. We still keep the decrypt button for ACL-proof
   * demonstration, but mark the operation as redundant in copy. */
  transferred?: boolean;
}

/** Reads the recipient's encrypted allocation handle via `requestMyAllocation`
 * (a view function whose msg.sender check is satisfied by wagmi forwarding the
 * connected account) and exposes a userDecrypt button. The decrypted plaintext
 * never leaves the browser session — it lives in a single useState. */
export function AllocationCard({
  campaignAddress,
  account,
  decimals,
  symbol,
  transferred,
}: AllocationCardProps) {
  const {
    data: handleData,
    error: handleError,
    isLoading: handleLoading,
  } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "requestMyAllocation",
    account,
  });

  const handle = handleData as `0x${string}` | undefined;

  const { decrypt, data, error, isPending, stage, reset } =
    useUserDecryptEuint64();

  const handleDecrypt = () => {
    if (!handle) return;
    void decrypt({ handle, contractAddress: campaignAddress });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your encrypted allocation</CardTitle>
        <CardDescription>
          The amount lives on-chain as a ciphertext handle. Only your wallet can
          unwrap it via re-encryption — no one else (admin, auditor, executor)
          can read your number.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {data === undefined ? (
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Encrypted on-chain
            </div>
            <div className="mt-1 break-all font-mono text-sm">
              {handleLoading
                ? "Loading…"
                : handle
                  ? shortHandle(handle)
                  : "—"}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-cipher/40 bg-cipher/5 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Decrypted · Visible only to you in this browser session
            </div>
            <div className="mt-2 font-mono text-3xl font-semibold tracking-tight">
              {formatTokenAmount(data, decimals, symbol)}
            </div>
          </div>
        )}

        {handleError && (
          <Alert variant="destructive">
            <AlertTitle>Cannot read allocation handle</AlertTitle>
            <AlertDescription>{handleError.message}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Decryption failed</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {data === undefined ? (
            <Button
              onClick={handleDecrypt}
              disabled={!handle || isPending}
            >
              {isPending ? "Decrypting…" : "Decrypt my amount"}
            </Button>
          ) : (
            <Button variant="outline" onClick={reset}>
              Reset
            </Button>
          )}
          {isPending && stage !== "idle" && (
            <span className="font-mono text-xs italic text-muted-foreground">
              {describeStage(stage)}
            </span>
          )}
        </div>

        {transferred && (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            ◢ Amount is already public via the ERC-20 Transfer event.
            Re-decrypting confirms your wallet still holds ACL access — no new
            information revealed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
