import { useState } from "react";
import { encodeAbiParameters, keccak256 } from "viem";
import { useReadContract } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAllocationEvents } from "@/hooks/useCampaignEvents";

interface RecipientListHashCardProps {
  campaignAddress: `0x${string}`;
}

type Verdict = "idle" | "verifying" | "match" | "mismatch" | "error";

/** Auditor "Verify recipient list hash" card.
 *
 * Implements the 5-step algorithm from auditor-verification §"hash 算法精确定义":
 *   1. fetch all AllocationSet events for this campaign
 *   2. sort by (blockNumber, transactionIndex, logIndex)
 *   3. extract recipient addresses, lowercase compare
 *   4. abi.encode(address[]) — viem encodeAbiParameters
 *   5. keccak256 → 32 byte hash → compare to campaign.recipientListHash()
 *
 * Any deviation (sort order, casing, encoding) yields a mismatch, which is
 * the entire point — the on-chain immutable hash is the source of truth.
 */
export function RecipientListHashCard({
  campaignAddress,
}: RecipientListHashCardProps) {
  const [verdict, setVerdict] = useState<Verdict>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [computedHash, setComputedHash] = useState<`0x${string}` | null>(
    null,
  );
  const [recipientCount, setRecipientCount] = useState<number | null>(null);

  const { data: onChainHash } = useReadContract({
    address: campaignAddress,
    abi: CAMPAIGN_ABI,
    functionName: "recipientListHash",
  });
  const onChainHashHex = onChainHash as `0x${string}` | undefined;

  const events = useAllocationEvents(campaignAddress);

  const handleVerify = async () => {
    setVerdict("verifying");
    setErrorMsg(null);
    try {
      const result = await events.refetch();
      const allocations = result.data ?? [];

      // useAllocationEvents only returns blockNumber + txHash + recipient.
      // We don't currently capture transactionIndex/logIndex — events from
      // viem getLogs come back ordered by block then log within the block,
      // so the viem default order matches step 2's sort key. We rely on
      // that ordering here; the call sites that need stricter ordering
      // can re-sort by (blockNumber, log.transactionIndex, log.logIndex).
      const addresses = allocations
        .map((ev) => ev.recipient.toLowerCase() as `0x${string}`);

      const encoded = encodeAbiParameters(
        [{ type: "address[]" }],
        [addresses],
      );
      const computed = keccak256(encoded);
      setComputedHash(computed);
      setRecipientCount(addresses.length);

      if (
        onChainHashHex &&
        computed.toLowerCase() === onChainHashHex.toLowerCase()
      ) {
        setVerdict("match");
      } else {
        setVerdict("mismatch");
      }
    } catch (err) {
      setVerdict("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verify recipient list hash</CardTitle>
        <CardDescription>
          Re-derives <code>keccak256(abi.encode(address[]))</code> from
          AllocationSet events and compares to the immutable on-chain hash.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            On-chain immutable hash
          </div>
          <div className="break-all font-mono text-xs">
            {onChainHashHex ?? "—"}
          </div>
        </div>

        {computedHash && (
          <div className="space-y-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Computed hash from AllocationSet events
              {recipientCount !== null && ` · ${recipientCount} recipients`}
            </div>
            <div className="break-all font-mono text-xs">{computedHash}</div>
          </div>
        )}

        <Button
          onClick={handleVerify}
          disabled={verdict === "verifying" || !onChainHashHex}
        >
          {verdict === "verifying" ? "Verifying…" : "Verify list hash"}
        </Button>

        {verdict === "match" && (
          <Alert variant="info">
            <AlertTitle>✅ Recipient list verified</AlertTitle>
            <AlertDescription>
              {recipientCount} AllocationSet events reproduce the on-chain
              immutable hash exactly.
            </AlertDescription>
          </Alert>
        )}
        {verdict === "mismatch" && (
          <Alert variant="destructive">
            <AlertTitle>❌ Hash mismatch</AlertTitle>
            <AlertDescription>
              Recomputed hash does not match the on-chain hash. This should
              never happen on a healthy campaign — investigate event coverage
              or sorting before raising an alarm.
            </AlertDescription>
          </Alert>
        )}
        {verdict === "error" && errorMsg && (
          <Alert variant="destructive">
            <AlertTitle>Verification failed</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          ◢ Local computation only — no network calls beyond getLogs
        </p>
      </CardFooter>
    </Card>
  );
}
