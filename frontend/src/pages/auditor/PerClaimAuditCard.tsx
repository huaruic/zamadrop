import { useQuery } from "@tanstack/react-query";
import { decodeFunctionData } from "viem";
import { usePublicClient } from "wagmi";

import { CAMPAIGN_ABI } from "@/abis";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ETHERSCAN_BASE } from "@/config";
import { useTransferredEvents } from "@/hooks/useCampaignEvents";
import { formatTokenAmount } from "@/hooks/useTokenMeta";

interface PerClaimAuditCardProps {
  campaignAddress: `0x${string}`;
  decimals: number;
  symbol?: string;
}

interface ClaimAuditRow {
  recipient: `0x${string}`;
  amount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  decryptionProof: `0x${string}` | null;
  decodeError?: string;
}

/** Per-claim audit trail.
 *
 * For every TokenTransferred event we fetch the originating tx, decode the
 * `executeTransfer(user, amount, decryptionProof)` calldata, and surface the
 * KMS proof bytes alongside the (handle, amount) tuple.
 *
 * The Zama relayer SDK does not currently expose a public client-side
 * `FHE.checkSignatures`-equivalent verify in v0.4.x — so this view defers
 * actual cryptographic verification to the contract (every executeTransfer
 * tx already includes `FHE.checkSignatures` and would have reverted on a
 * forged proof). What we surface here is the proof bytes for human / forensic
 * inspection. The presence of a successful executeTransfer tx in the chain
 * IS the verification.
 */
export function PerClaimAuditCard({
  campaignAddress,
  decimals,
  symbol,
}: PerClaimAuditCardProps) {
  const publicClient = usePublicClient();
  const { data: transferEvents, isLoading } =
    useTransferredEvents(campaignAddress);

  const { data: rows } = useQuery<ClaimAuditRow[]>({
    queryKey: [
      "per-claim-audit",
      campaignAddress,
      transferEvents?.map((e) => e.txHash).join(","),
    ],
    enabled: !!publicClient && !!transferEvents,
    queryFn: async () => {
      if (!publicClient || !transferEvents) return [];
      const out: ClaimAuditRow[] = [];
      for (const ev of transferEvents) {
        const tx = await publicClient.getTransaction({ hash: ev.txHash });
        let decryptionProof: `0x${string}` | null = null;
        let decodeError: string | undefined;
        try {
          const decoded = decodeFunctionData({
            abi: CAMPAIGN_ABI,
            data: tx.input,
          });
          if (decoded.functionName === "executeTransfer") {
            const args = decoded.args as readonly [
              `0x${string}`,
              bigint,
              `0x${string}`,
            ];
            decryptionProof = args[2];
          }
        } catch (err) {
          decodeError = err instanceof Error ? err.message : String(err);
        }
        out.push({
          recipient: ev.recipient,
          amount: ev.amount,
          txHash: ev.txHash,
          blockNumber: ev.blockNumber,
          decryptionProof,
          decodeError,
        });
      }
      return out;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-claim audit trail</CardTitle>
        <CardDescription>
          Every executeTransfer tx with its KMS decryption proof. The proof was
          checked on-chain via <code>FHE.checkSignatures</code>; a successful
          tx implies a valid threshold-KMS signature.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !rows ? (
          <p className="font-mono text-xs text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            No settled claims yet.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.txHash}
                className="rounded-md border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={`${ETHERSCAN_BASE}/tx/${row.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-foreground hover:text-primary hover:underline"
                  >
                    {shortHash(row.txHash)}
                  </a>
                  <Badge variant="success">
                    ✓ KMS-signed
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <KV label="Recipient" value={shortAddr(row.recipient)} />
                  <KV
                    label="Amount"
                    value={formatTokenAmount(row.amount, decimals, symbol)}
                  />
                  <KV
                    label="Block"
                    value={row.blockNumber.toString()}
                  />
                </div>
                {row.decryptionProof ? (
                  <div className="mt-3">
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Decryption proof (raw bytes)
                    </div>
                    <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {row.decryptionProof.slice(0, 80)}…
                      {row.decryptionProof.slice(-40)}
                    </div>
                  </div>
                ) : row.decodeError ? (
                  <Alert variant="muted" className="mt-3">
                    <AlertDescription className="text-[11px]">
                      Could not decode tx input: {row.decodeError}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          ◢ On-chain FHE.checkSignatures is the verifier; this view shows the
          paper trail
        </p>
      </CardFooter>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-xs">{value}</div>
    </div>
  );
}

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortHash(hash: `0x${string}`): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
