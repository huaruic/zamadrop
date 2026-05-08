# bulk-allocation — implementation tasks

## 1. Contract

- [x] 1.1 Add `error ArrayLengthMismatch();` next to existing custom errors in `contracts/ZamaDropCampaign.sol`
- [x] 1.2 Add `function setAllocationsBatch(address[] calldata recipients, externalEuint64[] calldata encAmounts, bytes calldata inputProof) external` per design §2 — verbatim per-recipient body from existing `setAllocation`, looped with array indexing
- [x] 1.3 Verify all existing `setAllocation` natspec / inline comments still reflect reality after sibling function added (no semantic change to single-call path)
- [x] 1.4 Run `npm run compile` — must succeed with no warnings beyond the existing fhevm-plugin baseline

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
- [x] 3.6 `cd frontend && npm run build && npm run lint` — must keep lint baseline ≤ 8 (achieved: 6 pre-existing errors)

## 4. Backend

- [x] 4.1 Backend indexer (`backend/src/indexer/worker.ts`) emits `AllocationSet(recipient)` per recipient regardless of batch — verified by sub-agent review: indexer is event-signature-driven, no change needed (16/16 backend tests pass).

## 5. CLI script

- [x] 5.1 `scripts/cli-setup.ts` — replaced per-recipient setAllocation loop with `setAllocationsBatched` helper mirroring frontend `deploy.ts` pattern. Keeps idempotent guard (filters already-set recipients). At N=2 demo it produces one batched tx instead of two single-call txs.
- [ ] 5.2 Manual run: `RECIPIENTS=<50 addrs> ... npx hardhat run scripts/cli-setup.ts --network localhost` — must succeed against local hardhat in ≤ 4 batches (BATCH_SIZE=16, ⌈50/16⌉=4). Deferred: requires env-var driven recipient list which is a larger refactor; tracked separately.

## 6. Documentation

- [x] 6.1 `AGENTS.md`: invariant #4 documents `BATCH_SIZE = 16` with HCU citation (binding) + relayer SDK 32 + Sepolia gas as informational so future agents don't try to bump casually
- [x] 6.2 `docs/SECURITY.md` §8.5: note that batch size is bounded by FHEVM HCU per-tx budget (binding), relayer SDK packing, and EVM block gas — not a tunable
- [x] 6.3 `docs/LEARNINGS.md`: entry "bulk-allocation batch ceiling = 16 (HCU-bound)" with three-constraint analysis

## 7. Smart-wallet path documentation (this iteration's deferred decision)

- [x] 7.1 Confirmed `design.md §4.1` (rejected alternatives — smart wallet AA/EIP-7702) is comprehensive. `docs/LEARNINGS.md` "bulk-allocation batch ceiling = 16 (HCU-bound)" entry cross-links design.md §4.1 with smart-wallet revisit conditions.

## 8. Verification

- [x] 8.1 `npm run compile && npm test` — 65/65 tests pass (existing 57 + new 8 = 65 total)
- [x] 8.2 `npm run coverage` — ZamaDropCampaign.sol = 100% / 96.97% / 100% / 100% (stmts/branch/funcs/lines)
- [x] 8.3 `cd frontend && npm run build` clean
- [x] 8.4 `cd frontend && npm run lint` baseline 6/8 (all pre-existing in shadcn ui + fhevm.ts)
- [x] 8.5 Backend regression check via sub-agent: indexer is event-signature-driven, 16/16 backend tests pass, no code change needed
- [ ] 8.6 Local hardhat e2e with N=50 — deferred along with task 5.2 (env-var driven recipient list)
- [ ] 8.7 (Optional) Sepolia smoke: deploy a real campaign with 33-40 recipients via wizard, verify batch path executes and finalize lands — deferred to follow-up

## 9. Ship

- [x] 9.1 PR #4 opened titled "feat: bulk-allocation — setAllocationsBatch (HCU-bounded chunking)"
- [x] 9.2 PR body documents: motivation (N=500 unusable), HCU + 3-constraint batch ceiling math, smart-wallet rejected alternatives, verification evidence
- [ ] 9.3 (Recommended) Run `/codex review` against PR #4 — deferred (PR already merged)
- [x] 9.4 PR #4 merged 2026-05-08. Archive in follow-up branch (`chore/bulk-allocation-followups`).
