import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ETHERSCAN_BASE } from "@/config";
import { useClaimedEvents } from "@/hooks/useCampaignEvents";

interface ClaimsActivityProps {
  campaignAddress: `0x${string}`;
}

/** Section 3 — public ledger of who claimed. Designed to make the privacy
 * boundary visible: addresses are public, amounts are not. */
export function ClaimsActivity({ campaignAddress }: ClaimsActivityProps) {
  const { data: events, isLoading, isError, error } =
    useClaimedEvents(campaignAddress);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim activity</CardTitle>
        <CardDescription>
          Public ledger of who has claimed. Amounts remain encrypted until
          ERC-20 settlement.
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
            No claims yet.
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
                        {shortAddr(ev.txHash)}
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

      <CardFooter>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          ◢ Auditor sees who claimed, not how much — design intent
        </p>
      </CardFooter>
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

function shortAddr(value: `0x${string}`): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
