import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ETHERSCAN_BASE } from "@/config";
import { useAllocationEvents } from "@/hooks/useCampaignEvents";
import { shortAddr, shortHash } from "./shortAddr";

interface AllocationLedgerProps {
  campaignAddress: `0x${string}`;
}

export function AllocationLedger({ campaignAddress }: AllocationLedgerProps) {
  const { data: events, isLoading, isError, error } =
    useAllocationEvents(campaignAddress);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Allocation ledger</CardTitle>
        <CardDescription>
          AllocationSet events emitted by this campaign. Amounts stay encrypted —
          only the recipient appears on-chain.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load events</AlertTitle>
            <AlertDescription>
              {error?.message ?? "Unknown error"}
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Loading…</p>
        ) : !events || events.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            No allocations set yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full font-mono text-xs">
              <thead className="bg-surface">
                <tr className="text-left">
                  <Th>Recipient</Th>
                  <Th>Tx</Th>
                  <Th>Block</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr
                    key={`${ev.txHash}-${ev.recipient}`}
                    className="border-t border-border"
                  >
                    <Td>
                      <a
                        href={`${ETHERSCAN_BASE}/address/${ev.recipient}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary hover:underline"
                      >
                        {shortAddr(ev.recipient)}
                      </a>
                    </Td>
                    <Td>
                      <a
                        href={`${ETHERSCAN_BASE}/tx/${ev.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary hover:underline"
                      >
                        {shortHash(ev.txHash)}
                      </a>
                    </Td>
                    <Td className="text-muted-foreground">
                      {ev.blockNumber.toString()}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className ?? ""}`.trim()}>{children}</td>;
}
