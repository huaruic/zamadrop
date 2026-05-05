import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { CAMPAIGN_ABI } from "../abis";
import { CONTRACTS, ETHERSCAN_BASE } from "../config";
import { RecipientClaimPanel } from "./RecipientClaimPanel";

const CAMPAIGN_COPY = {
  name: "ZamaDrop Confidential Distribution",
  publisher: "Ernest / ZamaDrop",
  publishedAt: "2026-05-04",
  claimEnd: "Open until publisher closes claim",
  privacyMode: "Wallet-gated eligibility only",
  verificationNote:
    "Allocations remain encrypted on-chain. The contract verifies the encrypted sum against the declared total before claim opens.",
} as const;

export function PublicTab() {
  const { address, isConnected } = useAccount();

  const { data: declaredTotal } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "declaredTotal",
  });
  const { data: recipientCount } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "recipientCount",
  });
  const { data: finalized } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "finalized",
  });
  const { data: admin } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "admin",
  });
  const { data: auditor } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "auditor",
  });
  const { data: token } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "token",
  });
  const { data: allocationSet } = useReadContract({
    abi: CAMPAIGN_ABI,
    address: CONTRACTS.campaign,
    functionName: "allocationSet",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const claimedEvents = useClaimedEventCount();
  const totalRecipients = Number(recipientCount ?? 0n);
  const claimedRecipients = claimedEvents ?? 0;
  const claimProgressPct =
    totalRecipients > 0 ? Math.min(100, Math.round((claimedRecipients / totalRecipients) * 100)) : 0;
  const campaignStatus = finalized ? "Active" : "Verification";

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa]">
        <div className="border-b border-[#d9d3c8] bg-[#f5e8a7] px-6 py-3 text-[11px] uppercase tracking-[0.22em] text-[#6b5600]">
          Public campaign page
        </div>
        <div className="grid gap-8 px-6 py-8 xl:grid-cols-[1.18fr_0.82fr]">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Confidential airdrop</div>
            <h2 className="mt-3 max-w-4xl text-[44px] font-medium leading-[0.95] tracking-[-0.06em] text-[#111111]">
              Private allocations. Public accountability.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[#5d5a53]">
              {CAMPAIGN_COPY.name} publishes campaign facts, verification metadata, and claim progress
              without exposing recipient-level amounts. Recipients connect wallet to verify only their own
              eligibility and claim privately.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Declared total" value={declaredTotal?.toString() ?? "—"} suffix="ZDT" />
              <MetricCard label="Recipients" value={recipientCount?.toString() ?? "—"} />
              <MetricCard label="Claimed recipients" value={claimedRecipients.toString()} />
              <MetricCard label="Progress" value={`${claimProgressPct}%`} />
            </div>
          </div>

          <div className="rounded-[24px] border border-[#1a1a1a] bg-[#111111] p-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-white/55">Campaign status</div>
                <div className="mt-3 text-[34px] leading-none tracking-[-0.05em]">{campaignStatus}</div>
              </div>
              <span className="rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-white/70">
                {finalized ? "claim open" : "pending finalize"}
              </span>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-white/55">
                <span>Recipient progress</span>
                <span>{claimProgressPct}%</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-[#f5e8a7]" style={{ width: `${claimProgressPct}%` }} />
              </div>
              <div className="mt-3 text-sm leading-6 text-white/68">
                Progress is disclosed by recipient count only. Claimed amount progress is intentionally hidden.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.02fr_0.98fr]">
        <div className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Campaign facts</div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <FactRow label="Publisher" value={CAMPAIGN_COPY.publisher} />
            <FactRow label="Published" value={CAMPAIGN_COPY.publishedAt} />
            <FactRow label="Claim end" value={CAMPAIGN_COPY.claimEnd} />
            <FactRow label="Visibility" value={CAMPAIGN_COPY.privacyMode} />
            <FactRow label="Token" value={token ? shortAddr(token as string) : "—"} href={token ? `${ETHERSCAN_BASE}/address/${token}` : undefined} />
            <FactRow
              label="Campaign contract"
              value={shortAddr(CONTRACTS.campaign)}
              href={`${ETHERSCAN_BASE}/address/${CONTRACTS.campaign}`}
            />
          </div>
        </div>

        <div className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Verification</div>
          <div className="mt-3 text-[30px] font-medium tracking-[-0.04em] text-[#111111]">
            Publicly verifiable, privately claimable
          </div>
          <p className="mt-4 text-sm leading-7 text-[#5d5a53]">{CAMPAIGN_COPY.verificationNote}</p>

          <div className="mt-6 space-y-3 rounded-[22px] border border-dashed border-[#d9d3c8] p-4">
            <FactRow label="Admin" value={admin ? shortAddr(admin as string) : "—"} href={admin ? `${ETHERSCAN_BASE}/address/${admin}` : undefined} />
            <FactRow label="Auditor" value={auditor ? shortAddr(auditor as string) : "—"} href={auditor ? `${ETHERSCAN_BASE}/address/${auditor}` : undefined} />
            <FactRow label="Encryption" value="fhEVM / euint64 allocations" />
            <FactRow label="Privacy rule" value="No recipient list. No public amount lookup." />
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-[#d9d3c8] bg-[#fffdfa] p-6">
        <div className="text-xs uppercase tracking-[0.2em] text-[#6a655d]">Eligibility and claim</div>
        {!isConnected ? (
          <div className="mt-4 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div>
              <div className="text-[34px] font-medium tracking-[-0.05em] text-[#111111]">
                Connect wallet to check only your own address
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#5d5a53]">
                This page does not support public address search. Connect the recipient wallet to verify eligibility,
                decrypt your allocation, and continue into the claim flow.
              </p>
            </div>
            <GuidePanel
              steps={[
                "Connect recipient wallet",
                "System checks current wallet only",
                "Eligible wallets can decrypt and claim privately",
              ]}
            />
          </div>
        ) : allocationSet === false ? (
          <div className="mt-4 grid gap-5 xl:grid-cols-[0.84fr_1.16fr]">
            <div>
              <div className="text-[34px] font-medium tracking-[-0.05em] text-[#111111]">Not eligible</div>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#5d5a53]">
                This wallet has no allocation in the current campaign. The product intentionally reveals nothing about
                any other recipient or amount.
              </p>
            </div>
            <GuidePanel
              steps={[
                `Checked wallet ${shortAddr(address as string)}`,
                "No allocation found for this address",
                "Only the connected wallet can be evaluated",
              ]}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-[#d9d3c8] bg-[#f5f1e8] px-5 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#7a746b]">Recipient access</div>
                <div className="mt-2 text-lg font-medium text-[#111111]">You are eligible</div>
              </div>
              <div className="text-sm text-[#5d5a53]">{shortAddr(address as string)}</div>
            </div>
            <RecipientClaimPanel />
          </div>
        )}
      </section>
    </div>
  );
}

function useClaimedEventCount() {
  const publicClient = usePublicClient();
  const [count, setCount] = useState<number>();

  useEffect(() => {
    if (!publicClient) return;
    const client = publicClient;

    let cancelled = false;

    async function load() {
      const events = await client.getLogs({
        address: CONTRACTS.campaign,
        event: {
          type: "event",
          name: "Claimed",
          inputs: [{ type: "address", indexed: true, name: "recipient" }],
        },
        fromBlock: "earliest",
        toBlock: "latest",
      });

      if (!cancelled) {
        setCount(events.length);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicClient]);

  return count;
}

function MetricCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-[22px] border border-[#d9d3c8] bg-white p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[#7a746b]">{label}</div>
      <div className="mt-3 text-[40px] leading-none tracking-[-0.06em] text-[#111111]">
        {value}
        {suffix ? <span className="ml-2 text-[16px] tracking-[-0.03em] text-[#5d5a53]">{suffix}</span> : null}
      </div>
    </div>
  );
}

function FactRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-5 border-b border-[#ece5d8] pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-[#6a655d]">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-right text-sm font-medium text-[#8a6700] hover:text-[#6e5200]"
        >
          {value} ↗
        </a>
      ) : (
        <span className="text-right text-sm font-medium text-[#111111]">{value}</span>
      )}
    </div>
  );
}

function GuidePanel({ steps }: { steps: string[] }) {
  return (
    <div className="rounded-[22px] border border-[#1a1a1a] p-5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-[#6a655d]">Flow</div>
      <div className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <div key={step} className="flex items-start gap-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#d9d3c8] text-[11px] font-medium text-[#111111]">
              {index + 1}
            </div>
            <div className="pt-1 text-sm leading-6 text-[#5d5a53]">{step}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
