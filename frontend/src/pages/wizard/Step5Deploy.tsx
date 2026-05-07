import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import type { Hex } from "viem";

import { ERC20_ABI } from "@/abis";
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
import { CONTRACTS, ETHERSCAN_BASE, SEPOLIA_CHAIN_ID } from "@/config";
import { getFhevmInstance } from "@/fhevm";

import {
  executeDeployment,
  FinalizeFailureError,
  type DeployContext,
  type DeployPhase,
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
  5: "5.5 Verify with KMS (active pull)",
};

/** Conservative lower bound for ETH balance before we let the user click
 * through to spend N+3 signatures. 0.005 ETH covers a single deploy on
 * Sepolia at ~30 gwei; we don't try to compute the real total because we'd
 * need gas estimates for unbroadcast txs. If the user runs out mid-flow,
 * the wallet will reject — and the Retry button + idempotent fund/finalize
 * make recovery cheap. */
const MIN_ETH_BALANCE = 5_000_000_000_000_000n; // 0.005 ETH

/** Wallet-popup hint threshold. If we're stuck in `awaiting_signature` for
 * more than this, show a "check your wallet / popup blocker" alert. */
const POPUP_HINT_DELAY_MS = 8_000;

/** Payload we POST to /api/register-campaign. Cached so a Retry register
 * button can re-fire without re-deriving the args from store state. */
interface RegisterPayload {
  address: `0x${string}`;
  admin: `0x${string}`;
  auditor: `0x${string}` | "";
  name: string | null;
  description: string | null;
}

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
  /** Sub-step phase, used to render Etherscan tx links and the wallet popup
   * hint. Lives in component state — never persisted; if the user refreshes
   * mid-flow the store partialize whitelist already drops `deployStep`, so
   * this would be inconsistent if persisted. */
  const [phase, setPhase] = useState<DeployPhase | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [phaseStartedAt, setPhaseStartedAt] = useState<number | null>(null);
  const [showPopupHint, setShowPopupHint] = useState(false);
  /** Surfaced when chain deploy succeeded but backend registration failed.
   * Non-blocking: the campaign is fully usable via direct /c/<address> URL;
   * the warning only tells the admin that Home page discovery won't pick it
   * up until someone re-registers. */
  const [registrationWarning, setRegistrationWarning] = useState<string | null>(
    null,
  );
  const [registerPayload, setRegisterPayload] =
    useState<RegisterPayload | null>(null);
  const [registerPending, setRegisterPending] = useState(false);
  /** Bumped by the Retry button to re-trigger the deploy effect. The effect's
   * `startedRef` gate is reset alongside this so a single user click cleanly
   * re-runs from the top of `executeDeployment`. */
  const [retryNonce, setRetryNonce] = useState(0);

  // Guard against StrictMode double-invoke firing the deploy twice. We only
  // run once per page mount; Retry resets this in tandem with `retryNonce`.
  const startedRef = useRef(false);

  // Wallet popup hint: schedule a one-shot tick after POPUP_HINT_DELAY_MS to
  // flip the hint on, and clear/reset it asynchronously when the phase
  // changes. Both setShowPopupHint calls live inside a setTimeout so the
  // effect body itself stays free of synchronous setState (satisfies
  // `react-hooks/set-state-in-effect` and `react-hooks/purity`).
  useEffect(() => {
    const off = setTimeout(() => setShowPopupHint(false), 0);
    if (phase !== "awaiting_signature" || phaseStartedAt == null) {
      return () => clearTimeout(off);
    }
    const elapsed = Date.now() - phaseStartedAt;
    const remaining = Math.max(0, POPUP_HINT_DELAY_MS - elapsed);
    const on = setTimeout(() => setShowPopupHint(true), remaining);
    return () => {
      clearTimeout(off);
      clearTimeout(on);
    };
  }, [phase, phaseStartedAt]);

  useEffect(() => {
    if (startedRef.current) return;
    // Wallet/clients are guarded at render time below; if we got here, they
    // exist. We still dereference them lazily to make the linter happy.
    if (!walletAddress || !walletClient || !publicClient) return;

    startedRef.current = true;

    void (async () => {
      // L1/L2 final check — store-only invariants
      if (!snapshot) {
        setErrorMsg(
          "No snapshot present. Return to Step 4 and capture a snapshot first.",
        );
        startedRef.current = false;
        return;
      }
      if (snapshot.draftVersion !== draftVersion) {
        setErrorMsg(
          "Snapshot is stale (draft was edited after capture). Return to Step 4 to recapture.",
        );
        startedRef.current = false;
        return;
      }
      if (recipients.length === 0) {
        setErrorMsg("Recipient list is empty. Return to Step 2.");
        startedRef.current = false;
        return;
      }
      if (!auditor) {
        setErrorMsg("Auditor address missing. Return to Step 3.");
        startedRef.current = false;
        return;
      }

      // L3 final check — read chain state right before we burn gas. Wrong
      // network / no ETH / not enough ZDT all surface as recoverable errors;
      // the Retry button re-runs this whole block.
      try {
        const [chainId, ethBalance, zdtBalance] = await Promise.all([
          publicClient.getChainId(),
          publicClient.getBalance({
            address: walletAddress as `0x${string}`,
          }),
          publicClient.readContract({
            address: TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [walletAddress as `0x${string}`],
          }) as Promise<bigint>,
        ]);
        if (chainId !== SEPOLIA_CHAIN_ID) {
          setErrorMsg(
            `Wrong network — switch your wallet to Sepolia (chain ID ${SEPOLIA_CHAIN_ID}).`,
          );
          setStatus("failed_partial");
          startedRef.current = false;
          return;
        }
        if (ethBalance < MIN_ETH_BALANCE) {
          setErrorMsg(
            `Insufficient ETH for gas (have ${ethBalance} wei, need ≥ ${MIN_ETH_BALANCE}). Top up via a Sepolia faucet (e.g. https://sepoliafaucet.com or https://www.alchemy.com/faucets/ethereum-sepolia) before retrying.`,
          );
          setStatus("failed_partial");
          startedRef.current = false;
          return;
        }
        if (zdtBalance < snapshot.declaredTotal) {
          setErrorMsg(
            `Insufficient ZDT balance — declared total ${snapshot.declaredTotal} > wallet balance ${zdtBalance}. Top up the admin wallet with ZDT before retrying.`,
          );
          setStatus("failed_partial");
          startedRef.current = false;
          return;
        }
      } catch (precheckErr) {
        setErrorMsg(
          `Pre-deploy chain check failed: ${
            precheckErr instanceof Error
              ? precheckErr.message
              : String(precheckErr)
          }`,
        );
        setStatus("failed_partial");
        startedRef.current = false;
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
          onProgress: (step, d, meta) => {
            setDeployStep(step);
            if (d) setDetail(d);
            if (meta?.phase !== undefined) {
              setPhase(meta.phase);
              setPhaseStartedAt(
                meta.phase === "awaiting_signature" ? Date.now() : null,
              );
            }
            if (meta?.txHash !== undefined) {
              setTxHash(meta.txHash);
            }
          },
          onAllocated: (addr) => {
            markAllocated(addr);
          },
        };
        const deployedAddress = await executeDeployment(ctx);
        setCampaignAddress(deployedAddress);
        setStatus("deployed");
        // Clear in-flight phase indicators on success.
        setPhase(null);
        setTxHash(null);
        setPhaseStartedAt(null);

        // Best-effort backend registration so the campaign shows up on Home
        // (As Admin / Auditor / Recipient sections) and the indexer starts
        // tracking events. Chain deploy is the canonical source of truth, so
        // any failure here is non-fatal — we surface a warning but keep the
        // success state.
        const storeNow = useWizardStore.getState();
        const payload: RegisterPayload = {
          address: deployedAddress,
          admin: walletAddress as `0x${string}`,
          auditor,
          name: storeNow.name || null,
          description: storeNow.description || null,
        };
        setRegisterPayload(payload);
        await runRegister(payload, setRegistrationWarning);
      } catch (err) {
        setStatus("failed_partial");
        if (err instanceof FinalizeFailureError) {
          setCampaignAddress(err.campaignAddress);
          setErrorMsg(err.message);
          setErrorRecovery(
            err.kind === "failed"
              ? "The campaign entered Failed state. Open the admin view of the deployed campaign and click cancelCampaign to recover funds, then redeploy with corrected amounts."
              : "The relayer SDK could not reach the KMS gateway after 3 attempts. State remains Finalizing on chain — click Retry once the gateway recovers (fund/finalize are idempotent and won't be re-charged), or open the admin view to inspect.",
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
    retryNonce,
  ]);

  // Render-time guards (T2): if the user landed on Step 5 without a wallet
  // connection, show actionable cards instead of a frozen progress strip.
  if (!walletAddress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect your wallet</CardTitle>
          <CardDescription>
            Step 5 deploys directly from the connected admin EOA. Connect a
            wallet on Sepolia to continue.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!walletClient || !publicClient) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Initializing wallet client…</CardTitle>
          <CardDescription>
            Waiting for wagmi to provision the wallet/public clients. This
            should resolve within a second; refresh if it persists.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const N = recipients.length;
  const description =
    N > 0
      ? `${N} recipients · ${N + 3} wallet signatures: 1 deploy, 1 fund, ${N} setAllocation, 1 finalize. Step 5.5 verifies via KMS automatically (no signature).`
      : "N+3 wallet signatures: 1 deploy, 1 fund, N setAllocation, 1 finalize. Step 5.5 verifies via KMS automatically (no signature).";

  const handleRetry = () => {
    setErrorMsg(null);
    setErrorRecovery(null);
    setRegistrationWarning(null);
    setPhase(null);
    setTxHash(null);
    setPhaseStartedAt(null);
    startedRef.current = false;
    setRetryNonce((n) => n + 1);
  };

  const handleRetryRegister = async () => {
    if (!registerPayload || registerPending) return;
    setRegisterPending(true);
    try {
      await runRegister(registerPayload, setRegistrationWarning);
    } finally {
      setRegisterPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Deploying campaign</CardTitle>
              <CardDescription>{description}</CardDescription>
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
              const isActive = deployStep === s;
              return (
                <li key={s} className="flex items-start gap-3">
                  <SubStepDot status={sub} />
                  <div className="flex-1 font-mono text-xs">
                    <div className="font-semibold">
                      {STEP_LABELS[s]}
                      {s === 3 && (deployStep === 3 || deployStep > 3) && (
                        <span className="ml-2 text-muted-foreground">
                          {allocatedSoFar.length}/{recipients.length}
                        </span>
                      )}
                    </div>
                    {isActive && detail && (
                      <div className="text-muted-foreground">{detail}</div>
                    )}
                    {isActive && txHash && (
                      <a
                        href={`${ETHERSCAN_BASE}/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground hover:text-primary hover:underline"
                      >
                        View on Etherscan →
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {showPopupHint && (
            <Alert className="mt-3" variant="muted">
              <AlertTitle>Waiting on wallet popup</AlertTitle>
              <AlertDescription>
                Check your wallet for the popup. If you don't see it, your
                browser may have blocked it — disable the popup blocker for
                this site and click Retry.
              </AlertDescription>
            </Alert>
          )}
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
            <div>
              <Button onClick={handleRetry}>Retry</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {status === "deployed" && campaignAddress && (
        <SuccessCard
          campaignAddress={campaignAddress}
          onDone={() => {
            useWizardStore.getState().reset();
            navigate(`/c/${campaignAddress}`);
          }}
          registrationWarning={registrationWarning}
          onRetryRegister={
            registerPayload ? handleRetryRegister : undefined
          }
          registerPending={registerPending}
        />
      )}
    </div>
  );
}

/** POST to /api/register-campaign. Sets `setWarning(null)` on success and a
 * descriptive string on any non-2xx / network error. Extracted so first-call
 * (inside the deploy IIFE) and Retry-register (button click) share one
 * codepath. */
async function runRegister(
  payload: RegisterPayload,
  setWarning: (w: string | null) => void,
): Promise<void> {
  try {
    const backendUrl =
      import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
    const res = await fetch(`${backendUrl}/api/register-campaign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      setWarning(
        `Backend register returned ${res.status}. Campaign is live on chain; click Retry register to try again. ${text.slice(0, 200)}`,
      );
      return;
    }
    setWarning(null);
  } catch (regErr) {
    setWarning(
      `Backend unreachable — campaign is live on chain but won't appear on the Home page until it is registered. ${
        regErr instanceof Error ? regErr.message : String(regErr)
      }`,
    );
  }
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
  registrationWarning,
  onRetryRegister,
  registerPending,
}: {
  campaignAddress: `0x${string}`;
  onDone: () => void;
  registrationWarning?: string | null;
  onRetryRegister?: () => void;
  registerPending?: boolean;
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
        {registrationWarning && (
          <Alert variant="muted">
            <AlertTitle>Backend registration deferred</AlertTitle>
            <AlertDescription className="space-y-2 break-words">
              <p>{registrationWarning}</p>
              {onRetryRegister && (
                <div>
                  <Button
                    size="sm"
                    onClick={onRetryRegister}
                    disabled={registerPending}
                  >
                    {registerPending ? "Retrying…" : "Retry register"}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
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
