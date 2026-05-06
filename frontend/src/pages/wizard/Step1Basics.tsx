import { useNavigate } from "react-router-dom";
import { useAccount, useReadContract } from "wagmi";

import { ERC20_ABI } from "@/abis";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONTRACTS } from "@/config";

import { useWizardStore } from "./state";

/** Step 1 — Basics.
 *
 * Spec: admin-deployment-flow §"Step 1 — Basics"
 *
 *   - Collect campaign `name` (required) and optional `description`.
 *   - Display a read-only ZDT card: address, decimals (=0 per project), and
 *     the connected wallet's balance. There is intentionally NO token picker;
 *     ZDT is the only supported asset in the MVP.
 *
 * Token address is sourced from VITE_TOKEN_ADDRESS for redeploy flexibility,
 * falling back to the bundled CONTRACTS.token.
 */

const TOKEN_ADDRESS = ((): `0x${string}` => {
  const env = import.meta.env.VITE_TOKEN_ADDRESS as `0x${string}` | undefined;
  return env ?? CONTRACTS.token;
})();

export default function Step1Basics() {
  const navigate = useNavigate();
  const { address: walletAddress, isConnected } = useAccount();

  const name = useWizardStore((s) => s.name);
  const description = useWizardStore((s) => s.description);
  const setBasics = useWizardStore((s) => s.setBasics);
  const setStep = useWizardStore((s) => s.setStep);

  const { data: balanceRaw } = useReadContract({
    address: TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress },
  });
  const balance = balanceRaw as bigint | undefined;

  const canProceed = name.trim().length > 0;

  const handleNext = () => {
    if (!canProceed) return;
    setBasics(name.trim(), description.trim());
    setStep(2);
    void navigate("/wizard/recipients");
  };

  return (
    <div className="space-y-4">
      {!isConnected && (
        <Alert variant="warning">
          <AlertTitle>Connect a wallet</AlertTitle>
          <AlertDescription>
            Connect the admin wallet first — the next steps need it to read
            ZDT balance and sign deployment transactions.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Campaign basics</CardTitle>
          <CardDescription>
            A human-readable name for the campaign and an optional description.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="e.g. Q2 contributor airdrop"
              value={name}
              onChange={(e) => setBasics(e.target.value, description)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              placeholder="Short note about the campaign"
              value={description}
              onChange={(e) => setBasics(name, e.target.value)}
              autoComplete="off"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Token</CardTitle>
          <CardDescription>
            ZDT (ZamaDrop Test Token) — the only supported asset in this MVP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Cell label="Symbol" value="ZDT" />
            <Cell label="Decimals" value="0" />
            <Cell
              label="Address"
              value={`${TOKEN_ADDRESS.slice(0, 10)}…${TOKEN_ADDRESS.slice(-6)}`}
              title={TOKEN_ADDRESS}
            />
          </div>
          <div className="mt-4">
            <Cell
              label="Your balance"
              value={
                balance === undefined
                  ? walletAddress
                    ? "Loading…"
                    : "—"
                  : `${balance.toString()} ZDT`
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleNext} disabled={!canProceed}>
          Next · Recipients
        </Button>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-md border border-border bg-surface p-3"
      title={title}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}
