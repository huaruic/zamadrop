import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { encodeAbiParameters, keccak256 } from "viem";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";

import { useWizardStore } from "./state";

/** Step 4 — Review + snapshot lock.
 *
 * Spec: admin-deployment-flow §"Step 4 — Review 与 snapshot 锁"
 *
 *   - On mount, compute `listHash = keccak256(abi.encode(addresses))` and
 *     write a snapshot to the store. The snapshot embeds the current
 *     `draftVersion` so Step 5 can reject mismatched versions.
 *   - Show summary panels with explicit "Edit" buttons that bounce back to
 *     the relevant step. Editing recipients via Step 2 calls `bumpVersion`
 *     which advances `draftVersion` AND clears `snapshot` — so on return to
 *     Step 4 a fresh snapshot is computed from the new list.
 *   - Gate "Start Deploy" on a confirmation checkbox.
 *   - Show high-N gas warnings (orange at >50, red + 2nd confirm at >200).
 */

const GAS_WARNING_THRESHOLD = 50;
const GAS_HARD_THRESHOLD = 200;

export default function Step4Review() {
  const navigate = useNavigate();

  const name = useWizardStore((s) => s.name);
  const description = useWizardStore((s) => s.description);
  const recipients = useWizardStore((s) => s.recipients);
  const auditor = useWizardStore((s) => s.auditor);
  const draftVersion = useWizardStore((s) => s.draftVersion);
  const snapshot = useWizardStore((s) => s.snapshot);
  const setSnapshot = useWizardStore((s) => s.setSnapshot);
  const setStep = useWizardStore((s) => s.setStep);

  const [confirmed, setConfirmed] = useState(false);
  const [hardConfirm, setHardConfirm] = useState(false);

  const declaredTotal = useMemo(
    () => recipients.reduce((acc, r) => acc + r.amount, 0n),
    [recipients],
  );

  // Compute snapshot on mount (and whenever the underlying list/version
  // changes such that the existing snapshot is stale). bumpVersion in Step 2
  // also nulls out the snapshot, so the second predicate covers that path.
  useEffect(() => {
    if (recipients.length === 0) return;
    const isStale =
      !snapshot ||
      snapshot.draftVersion !== draftVersion ||
      snapshot.recipientCount !== recipients.length;
    if (!isStale) return;
    const addresses = recipients.map(
      (r) => r.address.toLowerCase() as `0x${string}`,
    );
    const encoded = encodeAbiParameters(
      [{ type: "address[]" }],
      [addresses],
    );
    const listHash = keccak256(encoded);
    setSnapshot({
      listHash,
      declaredTotal,
      recipientCount: recipients.length,
      capturedAt: Date.now(),
      draftVersion,
    });
  }, [recipients, draftVersion, snapshot, declaredTotal, setSnapshot]);

  const N = recipients.length;
  const showOrangeWarning = N > GAS_WARNING_THRESHOLD && N <= GAS_HARD_THRESHOLD;
  const showRedWarning = N > GAS_HARD_THRESHOLD;
  const gasEstimateEth = 0.05 + 0.005 + 0.004 * N + 0.03;

  const goToStep = (step: 1 | 2 | 3) => {
    setStep(step);
    const slug = step === 1 ? "basics" : step === 2 ? "recipients" : "auditor";
    void navigate(`/wizard/${slug}`);
  };

  const canStartDeploy =
    snapshot !== null &&
    snapshot.draftVersion === draftVersion &&
    confirmed &&
    (!showRedWarning || hardConfirm) &&
    name.trim().length > 0 &&
    auditor.length > 0 &&
    recipients.length > 0;

  const handleStartDeploy = () => {
    if (!canStartDeploy) return;
    setStep(5);
    void navigate("/wizard/deploy");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>
            One last check before deploy. Edits below will bring you back to
            this screen with a freshly recomputed snapshot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReviewRow
            label="Name"
            value={name || "—"}
            description={description}
            onEdit={() => goToStep(1)}
          />
          <ReviewRow
            label="Recipients"
            value={`${recipients.length} · total ${declaredTotal.toString()} ZDT`}
            onEdit={() => goToStep(2)}
          />
          <ReviewRow
            label="Auditor"
            value={auditor || "—"}
            onEdit={() => goToStep(3)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Snapshot</CardTitle>
          <CardDescription>
            keccak256(abi.encode(addresses)) — locked into the campaign
            constructor. If you Edit, the snapshot is recaptured here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          {snapshot ? (
            <>
              <Cell
                label="List hash"
                value={`${snapshot.listHash.slice(0, 14)}…${snapshot.listHash.slice(-8)}`}
                title={snapshot.listHash}
                mono
              />
              <Cell
                label="Declared total"
                value={`${snapshot.declaredTotal.toString()} ZDT`}
              />
              <Cell
                label="Recipient count"
                value={snapshot.recipientCount.toString()}
              />
              <Cell
                label="Captured at"
                value={new Date(snapshot.capturedAt).toLocaleString()}
              />
              <div className="flex items-center gap-2">
                <Label>Version</Label>
                <Badge
                  variant={
                    snapshot.draftVersion === draftVersion
                      ? "success"
                      : "danger"
                  }
                >
                  draft v{snapshot.draftVersion} ·{" "}
                  {snapshot.draftVersion === draftVersion
                    ? "fresh"
                    : "stale — recapture pending"}
                </Badge>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">Computing snapshot…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gas estimate</CardTitle>
          <CardDescription>
            One transaction per sub-step. setAllocation is one tx per
            recipient — there is no batch in V7.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-xs">
          <Cell
            label="Estimated total gas (ETH)"
            value={`~${gasEstimateEth.toFixed(3)} ETH`}
          />
          <Cell label="setAllocation calls" value={`${N}`} />
          {showOrangeWarning && (
            <Alert variant="warning">
              <AlertTitle>High gas cost</AlertTitle>
              <AlertDescription>
                {N} recipients will require {N} separate transactions. Total
                cost is ~{gasEstimateEth.toFixed(3)} ETH. Consider splitting
                into smaller campaigns.
              </AlertDescription>
            </Alert>
          )}
          {showRedWarning && (
            <Alert variant="destructive">
              <AlertTitle>Very high gas — second confirmation required</AlertTitle>
              <AlertDescription>
                {N} recipients exceeds the safe threshold ({GAS_HARD_THRESHOLD}).
                You must explicitly confirm below to proceed.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Confirm and deploy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 font-mono text-xs">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have reviewed all fields above and understand that deploy will
              issue {N + 3} wallet signatures (1 deploy, 1 fund, {N}{" "}
              setAllocation, 1 finalize).
            </span>
          </label>
          {showRedWarning && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={hardConfirm}
                onChange={(e) => setHardConfirm(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-destructive">
                I accept the high gas cost for a list of {N} recipients.
              </span>
            </label>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setStep(3);
            void navigate("/wizard/auditor");
          }}
        >
          Back
        </Button>
        <Button onClick={handleStartDeploy} disabled={!canStartDeploy}>
          Start Deploy
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  description,
  onEdit,
}: {
  label: string;
  value: string;
  description?: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 truncate font-mono text-sm font-semibold tracking-tight">
          {value}
        </div>
        {description && (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

function Cell({
  label,
  value,
  title,
  mono,
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div
      className="rounded-md border border-border bg-surface p-3"
      title={title}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div
        className={
          mono
            ? "mt-1 break-all font-mono text-xs"
            : "mt-1 font-mono text-sm font-semibold tracking-tight"
        }
      >
        {value}
      </div>
    </div>
  );
}
