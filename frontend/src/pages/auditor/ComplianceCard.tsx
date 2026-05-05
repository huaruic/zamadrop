import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Section 2 — explainer card. The pitch: FHE lets auditors get the aggregate
 * compliance answer without forcing recipients to surrender per-allocation data.
 * Pure presentational component, no contract reads. */
export function ComplianceCard() {
  return (
    <Card className="border-cipher/40 bg-cipher/5">
      <CardHeader>
        <CardTitle>Programmable compliance</CardTitle>
        <CardDescription>
          What FHE delivers to a regulator without breaking recipient privacy.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-2 font-mono text-xs leading-relaxed">
          <p>
            Auditor decrypts the <span className="text-cipher">claimed_total</span>{" "}
            aggregate.
          </p>
          <p>
            Auditor cannot decrypt any individual allocation, the running_total,
            or unclaimed amounts.
          </p>
          <p className="text-muted-foreground">
            This is FHE letting regulators receive aggregate compliance answers
            — without forcing anyone to surrender per-recipient data.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <BoundaryList
            label="Visible to auditor"
            tone="visible"
            items={[
              "claimed_total (aggregate)",
              "Claim activity events (who, when)",
              "declaredTotal",
              "recipientCount",
              "finalized state",
            ]}
          />
          <BoundaryList
            label="NOT visible to auditor"
            tone="hidden"
            items={[
              "Any individual allocation amount",
              "running_total during setup",
              "Unclaimed allocations",
              "Off-chain identity of recipients",
            ]}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function BoundaryList({
  label,
  tone,
  items,
}: {
  label: string;
  tone: "visible" | "hidden";
  items: string[];
}) {
  const accent =
    tone === "visible"
      ? "text-emerald-300 before:bg-emerald-400/60"
      : "text-destructive before:bg-destructive/60";

  return (
    <div className="space-y-2 rounded-md border border-border bg-card/40 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <ul className="space-y-1.5 font-mono text-xs">
        {items.map((item) => (
          <li
            key={item}
            className={`relative pl-4 before:absolute before:left-0 before:top-1.5 before:size-1.5 before:rounded-full ${accent}`}
          >
            <span className="text-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
