## 1. Store schema migration (PR 1)

- [ ] 1.1 Bump `PERSIST_SCHEMA_VERSION` from 1 to 2 in `frontend/src/pages/wizard/state.ts`
- [ ] 1.2 Add `campaignAddress`, `status`, `lastDeployError` to `partialize` whitelist
- [ ] 1.3 Add `lastDeployError` field type + `setLastDeployError` action to `WizardState`
- [ ] 1.4 Implement `migrate(persistedState, version)` — return `initialState` when `version < 2`
- [ ] 1.5 Add unit test covering migration drop: write a v1-shaped record to localStorage, mount the store, assert state equals `initialState`
- [ ] 1.6 Manually verify no other store consumer breaks (search usages of `useWizardStore` for affected fields)

## 2. deriveStep + multicall helper (PR 2)

- [ ] 2.1 Create `frontend/src/pages/wizard/derive-step.ts` exporting `deriveStep(chainState, recipients) → DeploySubStep | 'done' | 'failed'`
- [ ] 2.2 Define `ChainState` type: `{ state, declaredTotal, balance, allocationCount, recipientCount, allocationSet: Record<address, boolean> }`
- [ ] 2.3 Implement pure mapping table from design.md Decision 1 (5 cases × edge transitions)
- [ ] 2.4 Add `readChainStateForResume(publicClient, campaignAddress, recipients)` helper that batches reads via `Multicall3`
- [ ] 2.5 Multicall fallback: on multicall failure, retry as ≤16-recipient serial readContract batches
- [ ] 2.6 Write unit tests for `deriveStep`: 6 happy-path mappings + edge cases (balance == declared exactly, allocCount == N exactly, state transitions during read race)
- [ ] 2.7 Write integration test for `readChainStateForResume` against the Hardhat fhEVM mock — deploy a campaign, partially allocate, assert returned shape matches expected

## 3. deploy.ts — receipt status check + resumeFromStep (PR 3)

- [ ] 3.1 Add `TxRevertedError` class to `frontend/src/pages/wizard/deploy.ts` (extends Error, stores tx hash + sub-step)
- [ ] 3.2 Add `awaitOrThrow(client, hash, subStep)` helper wrapping `waitForTransactionReceipt` + `receipt.status` check
- [ ] 3.3 Replace 5 sites of `await client.waitForTransactionReceipt({ hash })` with `await awaitOrThrow(...)` (lines 251, 298, 387, 442, 480)
- [ ] 3.4 Extend `executeDeployment(ctx, resumeFromStep: DeploySubStep = 1)` signature
- [ ] 3.5 Wrap each sub-step block with `if (resumeFromStep <= N) { ... }` so 5.1/5.2/5.3 can be skipped on resume
- [ ] 3.6 Update existing idempotency guards (5.2 balance, 5.3 alreadyAllocated, 5.4 state, 5.5 state) so they still defend correctness independently of `resumeFromStep`
- [ ] 3.7 Map `TxRevertedError` to `lastDeployError({ kind: 'chain-error', message, recovery })` in `executeDeployment`'s catch
- [ ] 3.8 Add unit test: simulate a reverted tx in 5.3, assert `TxRevertedError` thrown and `allocatedSoFar` not advanced

## 4. Step5Deploy.tsx rewrite (PR 4)

- [ ] 4.1 Remove `startedRef = useRef(hasExistingExecutionState)` initialization; default to `false`
- [ ] 4.2 Add an effect that runs on mount: read chain state via `readChainStateForResume`, call `deriveStep`, store result in local state `resumeStep`
- [ ] 4.3 Render Resume banner when `campaignAddress` is in store and `deriveStep` result is not `'done'`/`'failed'`. Banner shows: campaign address, derived next step, "Resume" + "Discard" buttons
- [ ] 4.4 Wire "Resume" button to call `executeDeployment(ctx, resumeStep)`
- [ ] 4.5 Wire "Discard" button: if state == Setup, just clear `campaignAddress` from store; else show warning + redirect to Failed-recovery panel (cancelCampaign)
- [ ] 4.6 Replace `errorMsg` / `errorRecovery` component state with `useWizardStore(s => s.lastDeployError)` derivation
- [ ] 4.7 Render Failed-state recovery panel when `deriveStep` returns `'failed'` (state == Failed). Panel includes campaign address, escrow balance, cancelCampaign button
- [ ] 4.8 Wire cancelCampaign button: writeContract → awaitOrThrow → on success clear store + show "deploy a new campaign" CTA
- [ ] 4.9 Hide Resume / Retry buttons when chain state == Failed (only cancelCampaign is appropriate)
- [ ] 4.10 Add per-mount async lock to handle StrictMode double-invoke without re-issuing transactions
- [ ] 4.11 Persist `lastDeployError` to store from every `executeDeployment` catch path (KMS timeout, KMS failed, user reject, chain error, register error)
- [ ] 4.12 Verify `setCampaignAddress` is called immediately after `deployContract` returns successfully — confirms Decision 2 of design.md

## 5. Manual e2e verification on Sepolia (PR 5 / pre-merge gate)

- [ ] 5.1 Deploy fresh campaign with N=2, kill tab during 5.1, reopen — confirm Resume banner shows correct sub-step or fresh restart (5.1 not yet persisted)
- [ ] 5.2 Deploy fresh campaign, kill tab after 5.2 success, reopen — confirm Resume banner shows "Resume at 5.3"
- [ ] 5.3 Deploy fresh campaign, kill tab mid-5.3 (after some setAllocation success), reopen — confirm Resume picks up at correct recipient (chain reads, not in-memory)
- [ ] 5.4 Reproduce the 2026-05-09 incident: deploy → reject 5.4 in MetaMask → switch tab → return — confirm Resume banner shows, Resume button triggers finalize popup
- [ ] 5.5 Trigger Failed state (deploy with intentionally wrong allocation sum) → confirm Failed recovery panel shows, cancelCampaign returns ZDT to admin wallet
- [ ] 5.6 Force a setAllocation revert (deploy two recipients with same address via direct contract call to bypass L2) → confirm `TxRevertedError` halts wizard with clear message instead of advancing silently
- [ ] 5.7 Multi-tab smoke: open same campaign in two tabs, both attempt resume — confirm contract idempotency guards prevent double-charge (acceptable two competing UIs but no funds harm)

## 6. Documentation + cleanup

- [ ] 6.1 Append entry to `docs/LEARNINGS.md` summarizing chain-as-truth design and the 2026-05-09 reject incident that motivated it
- [ ] 6.2 Update `docs/WORKLOG.md` with PR sequence
- [ ] 6.3 Add a short README block in `frontend/src/pages/wizard/` explaining how `deriveStep` + `executeDeployment(resumeFromStep)` interact — warn future contributors not to reintroduce in-memory progress as source of truth
- [ ] 6.4 Verify all new/modified TypeScript files pass `npm run lint` and `npm run build`
- [ ] 6.5 Confirm `openspec validate wizard-resume-from-chain` passes before requesting archive
