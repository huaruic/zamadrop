# V8 finalize-recovery — implementation tasks

## 1. Contract changes

- [ ] 1.1 Add `enum State { Setup, Finalizing, Claiming, Failed, TimedOut }` (extend existing enum with new last value to preserve numeric values for V7 compatibility readers)
- [ ] 1.2 Add `error EscapeTimeoutNotReached();` and `error NotTimedOut();`
- [ ] 1.3 Add `uint256 public immutable finalizeEscapeTimeout;` set from constructor with `escapeTimeout_ == 0 ? 1 hours : escapeTimeout_` default
- [ ] 1.4 Add `uint256 public finalizeRequestedAt;` set in `finalize()` right before state transition to Finalizing
- [ ] 1.5 Add `event FinalizeTimedOut(uint256 finalizeAt, uint256 escapedAt);`
- [ ] 1.6 Add `function adminTimeoutCancel() external` — admin-only, requires Finalizing + timeout reached, transitions to TimedOut
- [ ] 1.7 Modify `callbackFinalize` state guard from `state != Finalizing` to `state != Finalizing && state != TimedOut`
- [ ] 1.8 Modify `cancelCampaign` state guard from `state != Failed` to `state != Failed && state != TimedOut`; when called from TimedOut, transition state to Failed BEFORE the transfer (state mutation before external call)
- [ ] 1.9 Update existing tests that depend on `cancelCampaign` requiring Failed; should still pass after state guard relaxation

## 2. Tests (target: 12 new cases on top of V7's 57)

- [ ] 2.1 `adminTimeoutCancel`: non-admin reverts NotAdmin
- [ ] 2.2 `adminTimeoutCancel`: state Setup reverts NotFinalizing
- [ ] 2.3 `adminTimeoutCancel`: state Claiming reverts NotFinalizing
- [ ] 2.4 `adminTimeoutCancel`: state Failed reverts NotFinalizing
- [ ] 2.5 `adminTimeoutCancel`: timestamp before deadline reverts EscapeTimeoutNotReached
- [ ] 2.6 `adminTimeoutCancel`: success → state == TimedOut, FinalizeTimedOut emitted with correct timestamps
- [ ] 2.7 `callbackFinalize(true)` from TimedOut → state == Claiming, recipients can claim normally
- [ ] 2.8 `callbackFinalize(false)` from TimedOut → state == Failed
- [ ] 2.9 `cancelCampaign` from TimedOut → admin receives full balance, state transitions to Failed
- [ ] 2.10 After cancelCampaign from TimedOut, late `callbackFinalize(true)` reverts NotFinalizing (state is Failed)
- [ ] 2.11 Constructor with `escapeTimeout_ = 0` → finalizeEscapeTimeout == 1 hours
- [ ] 2.12 Constructor with `escapeTimeout_ = 24 hours` → finalizeEscapeTimeout == 24 hours, adminTimeoutCancel respects the longer wait

Use `@nomicfoundation/hardhat-network-helpers/time.increase()` to fast-forward block.timestamp.

## 3. Coverage

- [ ] 3.1 Run `npm run coverage`; confirm ZamaDropCampaign.sol coverage stays ≥ 90% including all TimedOut branches and the new constructor parameter

## 4. Frontend ABI + UI

- [ ] 4.1 Regenerate `frontend/src/abis/*` from new ABI (TypeChain or manual export of new function + event + immutable)
- [ ] 4.2 Wire two new buttons on `pages/admin/AdminPage.tsx`:
  - "Force timeout cancel" — visible only when `state == Finalizing && elapsed >= finalizeEscapeTimeout`. Calls `adminTimeoutCancel()`.
  - "Cancel campaign (returns funds)" — visible when `state == TimedOut || state == Failed`. Calls `cancelCampaign()`.
  - Each button shows a confirmation dialog explaining the consequence (timeout cancel: "KMS may still rescue if it arrives before you cancel"; cancelCampaign from TimedOut: "irreversible — late KMS will revert").
- [ ] 4.3 Update `frontend/src/pages/wizard/deploy.ts`:
  - Extend `KMS_CALLBACK_TIMEOUT_MS` from 5 min to 15 min
  - On timeout, surface a non-error info card: "KMS taking longer than usual. State is still Finalizing on chain — check the admin page for status."
  - Add a "Continue without waiting" button that navigates to `/c/<address>?role=admin` immediately
- [ ] 4.4 Update `pages/CampaignDetail.tsx` to recognize and display `TimedOut` state alongside the existing four

## 5. Backend indexer

- [ ] 5.1 Add `FinalizeTimedOut` to `backend/src/chain/abi.ts`
- [ ] 5.2 Add event handler in `backend/src/indexer/worker.ts`: on FinalizeTimedOut, UPDATE campaigns SET state='timed_out' WHERE address = $1
- [ ] 5.3 Update Postgres schema (or check constraint) to allow `state IN ('setup','finalizing','claiming','failed','timed_out')`
- [ ] 5.4 Public APIs (`GET /api/campaigns?status=`) should accept `timed_out` as a valid filter

## 6. Deploy scripts

- [ ] 6.1 `deploy/01_deploy.ts`: add `ESCAPE_TIMEOUT` env var (default unset → contract uses 1 hour); pass to constructor as 7th arg
- [ ] 6.2 `scripts/cli-setup.ts`: same env var support
- [ ] 6.3 `scripts/verify-onchain.ts`, `scripts/verify-roles.ts`: print `finalizeEscapeTimeout` value

## 7. Documentation

- [ ] 7.1 Update `docs/SECURITY.md` to document the two-step recovery flow (TimedOut → Failed) and its trust implications (admin escape but KMS truth wins until cancelCampaign executes)
- [ ] 7.2 Update `openspec/changes/v7-dapp-wizard/specs/campaign-contract/spec.md` with a "Superseded in V8" pointer for the affected sections (or just the V8 spec replaces it once archived)
- [ ] 7.3 Add a `## V8 finalize-recovery` entry to `docs/LEARNINGS.md` with the empirical Sepolia KMS data that motivated the change

## 8. Verification

- [ ] 8.1 `npm run compile && npm test` (all 57 V7 + 12 new V8 = 69 passing)
- [ ] 8.2 `npm run coverage` ≥ 90%
- [ ] 8.3 `cd frontend && npm run build && npm run lint` (lint baseline ≤ 10 errors)
- [ ] 8.4 `cd backend && npm test` (existing 16 + any new = passing)
- [ ] 8.5 Local hardhat e2e: deploy with `ESCAPE_TIMEOUT=10` (10 sec for testing), drive full Finalizing → TimedOut → cancelCampaign flow, confirm funds returned to admin

## 9. Ship

- [ ] 9.1 Open PR titled "feat: V8 finalize-recovery — admin escape hatch + late-KMS preservation"
- [ ] 9.2 PR body documents: motivation (empirical 30+min Sepolia KMS observed during V7 testing), Codex review excerpts, two-step design rationale, breaking ABI change
- [ ] 9.3 After merge, `openspec archive v8-finalize-recovery`
