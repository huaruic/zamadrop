# V8 — Finalize timeout recovery (admin escape hatch + late-KMS preservation)

> **🔶 STATUS: DEFERRED to mainnet readiness — see [STATUS.md](./STATUS.md)**
>
> V7 active-pull KMS verification (shipped 2026-05-08) covers the dominant
> failure mode. Remaining tail risk (Gateway unreachable for hours+) is
> acceptable for v0.x testnet/demo positioning. Current limitation
> documented in `docs/SECURITY.md` §8.6. Revive this change before
> mainnet deployment with real funds.

## Why

> **Update 2026-05-08**: V7 wizard now uses **active-pull KMS verification**
> (relayer SDK `publicDecrypt` + self-submitted `callbackFinalize`),
> shipped in the same V7 PR. This handles the common "Gateway missed
> event" failure mode that motivated this change. V8's escape hatch
> remains useful for the **rare tail case** where the Gateway is truly
> unreachable for hours (network outage, threshold validator quorum
> loss). Priority drops from "ship-blocking" to "post-V7 quality
> improvement".

V7 (without active pull) shipped `Finalizing` as a state with **no escape
hatch**. If the Zama KMS gateway never delivers `callbackFinalize()`, the
campaign and its escrowed funds are **permanently locked**.

Today (2026-05-07) on Sepolia we saw this fire empirically:

- Campaign `0x5a20529d2c930CE73fdd299C10Db26E10D2FB80D` deployed cleanly,
  setAllocations and finalize() succeeded, then sat in `Finalizing` for
  **30+ minutes** with no KMS callback. 600 ZDT escrowed, no path to
  recovery via the existing V7 surface (`claim` requires Claiming,
  `withdrawExcess` requires Claiming, `cancelCampaign` requires Failed,
  `setAllocation`/`finalize` require Setup — every door closed).

AGENTS.md note "Gateway callback latency — testnet finalize callback takes
1-3 blocks; demos should finalize ahead of time" understates the problem:
in practice we observed 30+ min outages with no automated recovery
available.

For mainnet usage with real funds, this is a **ship-blocking safety hole**.

## What changes

Five coordinated changes across the contract, frontend, indexer, and spec:

### 1. New state `TimedOut` (distinct from `Failed`)

`enum State { Setup, Finalizing, Claiming, Failed, TimedOut }`

Rationale (per Codex review): keeping the existing `Failed` semantic
(KMS proved sum mismatch) intact is critical for auditor honesty and for
the `cancelCampaign()` justification ("no recipient could ever have
claimed"). Conflating timeout failure into `Failed` would require
auditors to lie about which path the campaign took.

### 2. `adminTimeoutCancel()` — moves `Finalizing → TimedOut`

Admin-only, callable after `block.timestamp >= finalizeRequestedAt + finalizeEscapeTimeout`.
Sets state to `TimedOut`, emits `FinalizeTimedOut(finalizeAt, escapedAt)`.
Does **not** transfer funds — see #4.

### 3. `callbackFinalize()` accepts `TimedOut → Claiming` (or `Failed`)

Updated state guard: `state == Finalizing || state == TimedOut`.

This preserves the trustless guarantee — if KMS eventually arrives with
`(true)`, recipients can still claim (provided admin has not yet executed
the second-step cancellation).

### 4. `cancelCampaign()` accepts `Failed || TimedOut`, transitions
   `TimedOut → Failed`

The existing `cancelCampaign()` is the irreversible cutoff. From `TimedOut`
it transfers the contract balance to admin AND transitions state to
`Failed`. After this point, late `callbackFinalize(true)` reverts because
state is no longer in the accepted set.

This is the explicit two-step UX:
1. Admin calls `adminTimeoutCancel()` → `TimedOut` (KMS still has a chance)
2. Admin calls `cancelCampaign()` → `Failed` (irreversible, funds returned)

### 5. `finalizeEscapeTimeout` — constructor parameter

```solidity
uint256 public immutable finalizeEscapeTimeout;
constructor(..., uint256 escapeTimeout_) {
    finalizeEscapeTimeout = escapeTimeout_ == 0 ? 1 hours : escapeTimeout_;
}
```

Sepolia: 1 hour. Mainnet: configurable per-deployment (recommended 48-72h
once Zama publishes mainnet KMS SLA).

## Impact

### Affected capabilities (`openspec/specs/`)

- **campaign-contract** — adds `TimedOut` state, `adminTimeoutCancel`,
  modified `callbackFinalize`/`cancelCampaign` guards, new immutable
  `finalizeEscapeTimeout`, new `FinalizeTimedOut` event.

### Affected code

- `contracts/ZamaDropCampaign.sol` — ~50 lines changed (state enum,
  errors, immutable, function additions, guard relaxations)
- `test/ZamaDropCampaign.test.ts` — ~12 new test cases
- `frontend/src/abis/*` — ABI re-export (function + event + immutable)
- `frontend/src/pages/admin/AdminPage.tsx` — two new conditional buttons
  (Force timeout cancel / Cancel campaign)
- `frontend/src/pages/wizard/deploy.ts` — extend wait timeout to align
  with contract; rewrite error copy
- `backend/src/indexer/worker.ts` — listen for `FinalizeTimedOut`,
  update campaign state to `timed_out`
- `deploy/01_deploy.ts`, `scripts/cli-setup.ts` — add `escapeTimeout`
  env var (default 1 hour for testnet)
- `docs/SECURITY.md` — document the two-step recovery flow

### Migration

This is a **breaking ABI change** for any existing V7 deployment. The
existing Sepolia campaigns (0x5a20…, etc.) cannot be upgraded; new
campaigns must be deployed against the new contract. Acceptable since V7
has not shipped to production.

## Out of scope

- Recipient voting on timeout (overkill; recipients aren't tracked
  on-chain by identity).
- Auditor-signed bypass (different product; abandons trustless sum
  check).
- ZK proof replacement of KMS (multi-month protocol work).
- Bulk-allocation scaling (separate V8 change `v8-bulk-allocation`).

## Sequencing

V7 ships first (already in flight on `feat/v7-e2e-and-ship`) with this
limitation explicitly documented in PR risks. V8 implementation begins
immediately after V7 merge. Estimated 6-8 hours.
