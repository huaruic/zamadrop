# bulk-allocation — implementation tasks

## 1. Contract

- [ ] 1.1 Add `error ArrayLengthMismatch();` next to existing custom errors in `contracts/ZamaDropCampaign.sol`
- [ ] 1.2 Add `function setAllocationsBatch(address[] calldata recipients, externalEuint64[] calldata encAmounts, bytes calldata inputProof) external` per design §2 — verbatim per-recipient body from existing `setAllocation`, looped with array indexing
- [ ] 1.3 Verify all existing `setAllocation` natspec / inline comments still reflect reality after sibling function added (no semantic change to single-call path)
- [ ] 1.4 Run `npm run compile` — must succeed with no warnings beyond the existing fhevm-plugin baseline

## 2. Tests

- [x] 2.1 Happy path: batch of 16 recipients (HCU ceiling), distinct addresses, sum = declaredTotal. Assert: `allocationCount == 16`, every `allocationSet[r] == true`, `AllocationSet` emitted N times, finalize succeeds afterwards
- [x] 2.2 Mixed sizes: batch of 1, batch of 5, batch of 16 — each path produces identical state to the same recipients via single-call `setAllocation`
- [x] 2.3 Duplicate within batch reverts `AllocationAlreadySet` — ensures atomicity (no partial state mutation when one entry conflicts)
- [x] 2.4 Duplicate across batches reverts `AllocationAlreadySet` — second call with overlapping recipient fails cleanly
- [x] 2.5 Mismatched array lengths revert `ArrayLengthMismatch` (recipients.length=3 vs encAmounts.length=4)
- [x] 2.6 Non-admin call reverts `NotAdmin`
- [x] 2.7 Wrong state (Finalizing / Claiming / Failed) reverts `NotSetup`
- [x] 2.8 Gas + HCU budget sanity: batch of 16 must fit under Sepolia 30M block gas — assert `receipt.gasUsed < 15_000_000`. Empirical 2026-05-08: batch of 32 reverts `HCUTransactionDepthLimitExceeded()` (HCU is binding, not gas). Test pinned at 16 so future loop changes catch HCU regressions.
- [x] 2.9 (Optional, off-chain) Document in test/comments that the binding limit is FHEVM HCU per-tx budget (HCULimit.sol), not the Zama relayer SDK's 32-uint64 packing limit
- [x] 2.10 Coverage gate: `npm run coverage` shows `setAllocationsBatch` ≥ 90% line + branch (achieved: ZamaDropCampaign.sol = 100% / 96.97% / 100% / 100%)

## 3. Frontend

- [x] 3.1 Regenerate ABI — typechain or manual export — to include `setAllocationsBatch` + `ArrayLengthMismatch` in `frontend/src/abis/*`
- [x] 3.2 Add `setAllocationsBatched` helper in `frontend/src/pages/wizard/deploy.ts` per design §3. `BATCH_SIZE = 16` const (HCU-bound).
- [x] 3.3 Update `executeDeployment` Step 5.3 dispatch: `recipients.length <= 5` keeps single `setOneAllocation` loop; `> 5` routes through `setAllocationsBatched`. Reuse existing `onProgress` / `onAllocated` callbacks.
- [x] 3.4 Step5Deploy.tsx progress copy: surface "batch X/Y" alongside "N/M done" so user sees signing cadence
- [x] 3.5 Update `frontend/src/lib/revert-reason.ts` — add `ArrayLengthMismatch` + `AllocationAlreadySet` to the humanizer
- [ ] 3.6 `cd frontend && npm run build && npm run lint` — must keep lint baseline ≤ 8

## 4. Backend

- [ ] 4.1 Backend indexer (`backend/src/indexer/worker.ts`) emits `AllocationSet(recipient)` per recipient regardless of batch — no change needed since the contract emits the same event in the loop. Verify by reading the worker code (no edits expected).

## 5. CLI script

- [ ] 5.1 `scripts/cli-setup.ts` — replace per-recipient setAllocation loop with chunked batch loop, mirroring frontend pattern. Keep idempotent guard (skip if already allocated).
- [ ] 5.2 Manual run: `RECIPIENTS=<50 addrs> ... npx hardhat run scripts/cli-setup.ts --network localhost` — must succeed against local hardhat in ≤ 3 batches

## 6. Documentation

- [x] 6.1 `AGENTS.md`: invariant #4 documents `BATCH_SIZE = 16` with HCU citation (binding) + relayer SDK 32 + Sepolia gas as informational so future agents don't try to bump casually
- [x] 6.2 `docs/SECURITY.md` §8.5: note that batch size is bounded by FHEVM HCU per-tx budget (binding), relayer SDK packing, and EVM block gas — not a tunable
- [x] 6.3 `docs/LEARNINGS.md`: entry "bulk-allocation batch ceiling = 16 (HCU-bound)" with three-constraint analysis

## 7. Smart-wallet path documentation (this iteration's deferred decision)

- [ ] 7.1 Confirm `design.md §4.1` (rejected alternatives — smart wallet AA/EIP-7702) is comprehensive enough as the canonical "why we didn't ship 1-signature UX yet" record. Cross-link from a one-line bullet in `docs/LEARNINGS.md`.

## 8. Verification

- [ ] 8.1 `npm run compile && npm test` — all existing 57 tests pass + new 9-10 tests pass = ~67 total
- [ ] 8.2 `npm run coverage` — `setAllocationsBatch` ≥ 90% line + branch
- [ ] 8.3 `cd frontend && npm run build` clean
- [ ] 8.4 `cd frontend && npm run lint` baseline ≤ 8
- [ ] 8.5 `cd backend && npm test` (no regressions; should be unaffected)
- [ ] 8.6 Local hardhat e2e: `RECIPIENTS=<50 addrs> npx hardhat run scripts/cli-setup.ts --network localhost` runs to Claiming
- [ ] 8.7 (Optional) Sepolia smoke: deploy a real campaign with 33-40 recipients via wizard, verify batch path executes and finalize lands

## 9. Ship

- [ ] 9.1 Open PR titled "feat: bulk-allocation — chunked setAllocation for medium drops"
- [ ] 9.2 PR body documents: motivation (N=500 unusable), batch ceiling math, smart-wallet rejected alternatives, verification evidence
- [ ] 9.3 (Recommended) Run `/codex review` against the PR — V7's `v7-dapp-wizard` had 31 Codex findings; expect this smaller change to have a few too
- [ ] 9.4 After PR merges, run `openspec archive bulk-allocation`
