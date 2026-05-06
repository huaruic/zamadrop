import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";

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
import { CONTRACTS } from "@/config";
import { getFhevmInstance } from "@/fhevm";

import {
  executeDeployment,
  FinalizeFailureError,
  type DeployContext,
  type DeploySubStep,
} from "./deploy";
import { useWizardStore } from "./state";

/** Step 5 — Deploy progress + result.
 *
 * Spec: admin-deployment-flow §"Step 5 — 5 个上链子步骤"
 *
 *   - On mount: read fhevm instance, walletClient, publicClient, do an L3
 *     final check (snapshot version matches store), then call
 *     executeDeployment with progress callbacks wired into the store.
 *   - Render the 5 sub-step strip with live status + recipient counter for
 *     5.3.
 *   - On success: show shareable URLs (admin / recipient / auditor) for
 *     `/c/<address>?role=…`.
 *   - On failure: render an actionable error message; for FinalizeFailureError
 *     specifically, point the user at withdrawExcess / cancelCampaign in the
 *     admin view of the deployed campaign.
 */

const TOKEN_ADDRESS = ((): `0x${string}` => {
  const env = import.meta.env.VITE_TOKEN_ADDRESS as `0x${string}` | undefined;
  return env ?? CONTRACTS.token;
})();

type SubStepStatus = "pending" | "active" | "done" | "error";

const STEP_LABELS: Record<DeploySubStep, string> = {
  1: "5.1 Deploy ZamaDropCampaign",
  2: "5.2 Fund campaign",
  3: "5.3 setAllocation × N",
  4: "5.4 finalize()",
  5: "5.5 Wait for KMS callback",
};

export default function Step5Deploy() {
  const navigate = useNavigate();
  const { address: walletAddress } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const recipients = useWizardStore((s) => s.recipients);
  const auditor = useWizardStore((s) => s.auditor);
  const snapshot = useWizardStore((s) => s.snapshot);
  const draftVersion = useWizardStore((s) => s.draftVersion);
  const deployStep = useWizardStore((s) => s.deployStep);
  const allocatedSoFar = useWizardStore((s) => s.allocatedSoFar);
  const campaignAddress = useWizardStore((s) => s.campaignAddress);
  const status = useWizardStore((s) => s.status);

  const setDeployStep = useWizardStore((s) => s.setDeployStep);
  const markAllocated = useWizardStore((s) => s.markAllocated);
  const setCampaignAddress = useWizardStore((s) => s.setCampaignAddress);
  const setStatus = useWizardStore((s) => s.setStatus);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorRecovery, setErrorRecovery] = useState<string | null>(null);
  const [detail, setDetail] = useState<string>("");

  // Guard against StrictMode double-invoke firing the deploy twice. We only
  // run once per page mount; if the user wants to retry they navigate away
  // and back.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!walletAddress) return;
    if (!walletClient) return;
    if (!publicClient) return;

    startedRef.current = true;

    void (async () => {
      // L3 final check (per spec: re-verify draft.version === snapshot.draftVersion
      // and confirm presence of all required state). We perform these in the
      // async IIFE rather than synchronously in the effect body to avoid the
      // setState-in-effect lint and let the precondition error render
      // identically to in-flight failures.
      if (!snapshot) {
        setErrorMsg(
          "No snapshot present. Return to Step 4 and capture a snapshot first.",
        );
        return;
      }
      if (snapshot.draftVersion !== draftVersion) {
        setErrorMsg(
          "Snapshot is stale (draft was edited after capture). Return to Step 4 to recapture.",
        );
        return;
      }
      if (recipients.length === 0) {
        setErrorMsg("Recipient list is empty. Return to Step 2.");
        return;
      }
      if (!auditor) {
        setErrorMsg("Auditor address missing. Return to Step 3.");
        return;
      }

      setStatus("deploying");
      try {
        const fhevm = await getFhevmInstance();
        const ctx: DeployContext = {
          walletClient,
          publicClient,
          fhevm,
          snapshot,
          recipients,
          auditor: auditor as `0x${string}`,
          tokenAddress: TOKEN_ADDRESS,
          adminAddress: walletAddress as `0x${string}`,
          existingCampaignAddress: campaignAddress ?? undefined,
          alreadyAllocated: new Set(allocatedSoFar),
          onProgress: (step, d) => {
            setDeployStep(step);
            if (d) setDetail(d);
          },
          onAllocated: (addr) => {
            markAllocated(addr);
          },
        };
        const deployedAddress = await executeDeployment(ctx);
        setCampaignAddress(deployedAddress);
        setStatus("deployed");
      } catch (err) {
        setStatus("failed_partial");
        if (err instanceof FinalizeFailureError) {
          setCampaignAddress(err.campaignAddress);
          setErrorMsg(err.message);
          setErrorRecovery(
            err.kind === "failed"
              ? "The campaign entered Failed state. Use cancelCampaign in the admin view of the deployed campaign to recover funds, then redeploy."
              : "The KMS callback timed out. Verify the campaign state — if it later settles to Claiming you may continue; if Failed, cancelCampaign; otherwise withdrawExcess once Claiming.",
          );
        } else {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
    })();
  }, [
    walletAddress,
    walletClient,
    publicClient,
    snapshot,
    draftVersion,
    recipients,
    auditor,
    campaignAddress,
    allocatedSoFar,
    setDeployStep,
    markAllocated,
    setCampaignAddress,
    setStatus,
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Deploying campaign</CardTitle>
              <CardDescription>
                5 sub-steps. Each emits a separate wallet signature.
              </CardDescription>
            </div>
            <Badge
              variant={
                status === "deployed"
                  ? "success"
                  : status === "failed_partial"
                    ? "danger"
                    : "cipher"
              }
            >
              {status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {([1, 2, 3, 4, 5] as DeploySubStep[]).map((s) => {
              const sub: SubStepStatus =
                errorMsg && s === deployStep
                  ? "error"
                  : deployStep > s
                    ? "done"
                    : deployStep === s
                      ? "active"
                      : "pending";
              return (
                <li key={s} className="flex items-center gap-3">
                  <SubStepDot status={sub} />
                  <div className="font-mono text-xs">
                    <div className="font-semibold">
                      {STEP_LABELS[s]}
                      {s === 3 && (deployStep === 3 || deployStep > 3) && (
                        <span className="ml-2 text-muted-foreground">
                          {allocatedSoFar.length}/{recipients.length}
                        </span>
                      )}
                    </div>
                    {deployStep === s && detail && (
                      <div className="text-muted-foreground">{detail}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertTitle>Deploy halted</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="break-words">{errorMsg}</p>
            {errorRecovery && (
              <p className="break-words">{errorRecovery}</p>
            )}
            {campaignAddress && (
              <p>
                Campaign was created at{" "}
                <Link
                  to={`/c/${campaignAddress}?role=admin`}
                  className="text-foreground hover:text-primary hover:underline"
                >
                  {campaignAddress}
                </Link>{" "}
                — open the admin view to recover.
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {status === "deployed" && campaignAddress && (
        <SuccessCard campaignAddress={campaignAddress} onDone={() => navigate(`/c/${campaignAddress}`)} />
      )}
    </div>
  );
}

function SubStepDot({ status }: { status: SubStepStatus }) {
  const cls =
    status === "done"
      ? "bg-cipher"
      : status === "active"
        ? "bg-primary animate-pulse"
        : status === "error"
          ? "bg-destructive"
          : "bg-border";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function SuccessCard({
  campaignAddress,
  onDone,
}: {
  campaignAddress: `0x${string}`;
  onDone: () => void;
}) {
  const base = window.location.origin;
  const adminUrl = `${base}/c/${campaignAddress}?role=admin`;
  const recipientUrl = `${base}/c/${campaignAddress}?role=recipient`;
  const auditorUrl = `${base}/c/${campaignAddress}?role=auditor`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign live</CardTitle>
        <CardDescription>
          Share these URLs with the recipients and auditor. Role is enforced
          on chain — the URL only suggests which view to open.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 font-mono text-xs">
        <ShareRow label="Admin" url={adminUrl} />
        <ShareRow label="Recipients" url={recipientUrl} />
        <ShareRow label="Auditor" url={auditorUrl} />
        <div className="flex justify-end pt-2">
          <Button onClick={onDone}>Done</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ShareRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <a
        href={url}
        className="break-all text-foreground hover:text-primary hover:underline"
      >
        {url}
      </a>
    </div>
  );
}
