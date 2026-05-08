# ZamaDrop Worklog

This file is for short-term handoff context. Keep it current, concise, and biased toward what the next human or model needs to know before continuing.

Do not duplicate OpenSpec tasks here. `openspec/changes/*/tasks.md` remains the source of truth for implementation checklists.

## 2026-05-09

### Active work

No OpenSpec change is currently being implemented in this repo. `main` is healthy and shippable. The only in-flight OpenSpec directory is `home-three-section-ia` (35/38, archive in progress on a parallel branch); `v8-finalize-recovery` is deferred (see below).

Pick the next change from "Next decision points" before starting fresh implementation.

### Last shipped

- **PR #1** (2026-05-07) — V7 dApp ship: 5-step wizard, active-pull KMS verification (`frontend/src/lib/kms-active-pull.ts`), Postgres indexer worker, executor wallet eliminated per ADR 0003 (frontend-as-primary-executor). 47 commits.
- **PR #4** (2026-05-08) — bulk-allocation: `setAllocationsBatch` on `ZamaDropCampaign`, frontend wizard chunking, `BATCH_SIZE = 16` (HCU is the binding constraint, not gas).
- **PR #6** (2026-05-08) — bulk-allocation followups: `cli-setup.ts` migrated to chunked batch path; spec delta promoted into `openspec/specs/campaign-contract/`; change archived.
- **PR #7** (2026-05-08) — V8 finalize-recovery deferred: `openspec/changes/v8-finalize-recovery/STATUS.md` marker added; `docs/SECURITY.md` §8.6 documents the KMS-unreachable boundary that V8 would close.

### V8 finalize-recovery — deferred (designed, not abandoned)

`openspec/changes/v8-finalize-recovery/` keeps `proposal.md` / `design.md` / `tasks.md` / `specs/` intact. The Codex-reviewed `TimedOut` two-state design is preserved. Revisit when any of: mainnet deployment with non-trivial funds, Zama publishes a mainnet KMS SLA, or a second prolonged Gateway outage on a real campaign. See `STATUS.md` for the trigger conditions.

V7 active-pull KMS verification covers the dominant failure mode (Sepolia "missed event" stalls compressed from 30+ min to ~10-15s). The remaining tail — Gateway truly unreachable for hours — is acceptable at v0.x testnet positioning.

### Next decision points (need user input)

- **Mainnet timing** — drives whether V8 finalize-recovery moves out of deferred and what `finalizeEscapeTimeout` default ships (testnet 1h vs mainnet 48-72h).
- **Multisig requirements** — if mainnet admin is a Safe / multisig instead of an EOA, the active-pull `pullAndCallbackFinalize` UX needs review (current flow assumes a single signer can submit the KMS callback tx).
- **Merkle eligibility prio** — listed out-of-scope in `CLAUDE.md` for MVP but is the most-requested feature gap. Decide whether it precedes or follows mainnet.
- **Recipient-list privacy** — blocks the P1 backlog filter "My access / Created by me / Auditor access" from `home-three-section-ia`.

### Risks (still load-bearing)

- Do not weaken KMS proof checks in `callbackFinalize` or `executeTransfer` (`kms-checkSignatures` invariant).
- Do not change `claim()` ordering — `claimed[addr] = true` must precede the FHE add and transfer so a revert unwinds the whole call.
- `claimedTotal` only mutates inside `claim()`; preserve that invariant.
- Sepolia KMS callback latency is 1-3 blocks; any new finalize UX must tolerate the wait.

### Verification baseline

`npm test` (root): **65/65** passing on `main`.
`cd frontend && npm run build`: succeeds (vite chunk-size warning is baseline).
`openspec list`: `home-three-section-ia 35/38` (archiving), `v8-finalize-recovery 0/44 DEFERRED`.
