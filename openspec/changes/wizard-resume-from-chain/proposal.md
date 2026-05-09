## Why

The 5-step admin deployment wizard cannot recover from any interruption: a MetaMask
rejection, popup-blocker hit, RPC blip, browser tab switch, or page refresh leaves
the user stranded with no path back to the campaign they just deployed. We hit this
on 2026-05-09 with campaign `0xf1c0…ddf3` — finalize was rejected at 5.4, the
React component state holding `errorMsg` was lost on tab switch, the `Retry`
button vanished, and on remount the wizard locked itself in a perma-spinning 5.1
because `startedRef` was initialized to `true` whenever any in-memory progress
existed.

Worse, this is a real funds-safety problem on mainnet: once 5.2 funds the
campaign, ZDT is locked in escrow until either `callbackFinalize` succeeds (state
→ Claiming) or `callbackFinalize(false)` lands (state → Failed, then
`cancelCampaign` is callable). If the wizard dies between 5.2 and 5.4 and the
admin loses the campaign address, the funds are stranded with no recovery path
in the current contract.

The fix is structural: **on-chain state is the only trustworthy progress
record**. The wizard must read it on every mount and derive the resume step
from chain truth, not from in-memory React state or a localStorage progress
field that is documented as "deliberately not persisted".

## What Changes

- **BREAKING (localStorage)**: zustand persist schema version bumps from 1 → 2.
  Old `zd:wizard-draft-v1` entries are dropped on first load (drafts only — no
  on-chain data is affected).
- Add `campaignAddress` to the persisted `partialize` whitelist. Persist it
  immediately after 5.1 deploy succeeds so the address survives every kind of
  wizard interruption.
- Remove the `startedRef = useRef(hasExistingExecutionState)` initial-value
  pattern in `Step5Deploy.tsx`. Replace with a per-deploy "in-flight token"
  that auto-resets across component mounts so a remount can always re-enter
  `executeDeployment` if the previous IIFE died with the component.
- Add `deriveStep(chainState) → DeploySubStep` that reads `(state, balance,
  allocationCount, recipientCount, allocationSet[r] for r in recipients)` and
  returns the correct sub-step to resume at. Replaces the in-memory
  `deployStep` / `allocatedSoFar` as the source of truth for "where are we".
- Extend `executeDeployment(ctx)` with an optional `resumeFromStep`
  parameter. Internal branches skip 5.1/5.2/5.3 cleanly when chain says they
  are already done.
- Persist `status` (`draft | deploying | deployed | failed_partial`) to the
  store. `errorMsg` becomes a derived view: `status==='failed_partial'` plus
  current chain state plus a short human-readable cause. The Retry button
  shows whenever `status==='failed_partial'`, regardless of whether the
  component just remounted.
- Check `receipt.status === "success"` after every `waitForTransactionReceipt`
  in `deploy.ts` (5.1, 5.2, 5.3, 5.4). Today silent on-chain reverts are
  treated as success — this is a real bug independent of resume semantics.
- When `chainState.state === Failed`, the wizard renders a Cancel & Recover
  panel that calls `cancelCampaign` (terminal escrow recovery). This wires
  in the Failed-path UI that already exists in the contract but is not
  exposed in wizard flow today.
- Surface a "you have a pending deploy at `<address>` — Resume / Discard"
  banner on Step 5 mount when `campaignAddress` is in the store. Discard
  requires explicit confirmation (and prefers Cancel & Recover when state
  is anything past Setup).

Out of scope (explicitly): cross-device resume via backend registry (a
separate concern), in-flight tx hash persistence (we use chain receipts as
truth, not pending tx state), and the `v8-finalize-recovery` timeout escape
hatch (separate active change). This proposal links UI hooks to V8 but does
not block on it.

## Capabilities

### New Capabilities
None. The change strengthens an existing capability rather than adding a new one.

### Modified Capabilities
- `admin-deployment-flow`: Adds resume-from-chain semantics for Step 5. The
  five sub-steps' on-chain behavior is unchanged; what changes is that the
  wizard must compute the current sub-step from chain state rather than
  in-memory progress, must persist `campaignAddress` after 5.1, must check
  receipt status, and must expose Failed-state recovery and a resume banner.

## Impact

- **Affected code**:
  - `frontend/src/pages/wizard/Step5Deploy.tsx` — mount logic, Retry/Resume
    handling, error rendering
  - `frontend/src/pages/wizard/deploy.ts` — `resumeFromStep` parameter,
    `receipt.status` checks at 5 sites
  - `frontend/src/pages/wizard/state.ts` — `partialize` whitelist,
    `PERSIST_SCHEMA_VERSION` bump, `status` persisted
  - `frontend/src/pages/wizard/derive-step.ts` — new file, pure function
- **Not affected**:
  - `contracts/ZamaDropCampaign.sol` — unchanged
  - Trust assumptions / privacy boundary — unchanged. Allocation flow,
    encryption, and KMS callback paths are untouched.
  - Backend `register-campaign` flow — unchanged. (Backend integration is
    a known-separate gap; tracked outside this change.)
- **Funds safety**: net positive. 5.1's address is now durable across
  every interruption mode short of clearing localStorage. Failed-state
  recovery is now reachable from the wizard. Locking-in-Setup remains
  possible until `v8-finalize-recovery` ships its timeout escape hatch —
  this change does not make that worse, only better-surfaced via the
  Resume banner so the admin can act.
- **Privacy boundary**: no change. Encrypted handles, ACL grants, and
  public-decryptability scope are untouched.
