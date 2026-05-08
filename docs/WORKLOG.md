# ZamaDrop Worklog

This file is for short-term handoff context. Keep it current, concise, and biased toward what the next human or model needs to know before continuing.

Do not duplicate OpenSpec tasks here. `openspec/changes/*/tasks.md` remains the source of truth for implementation checklists.

## 2026-05-08

### Active change

`openspec/changes/home-three-section-ia` — branch `feature/check-ui`

### Outcome

Frontend Home + CampaignCard refactored to three-section IA per the proposal. Educational modules (Entry points, Overview metrics, sidebar InfoCards) removed from app home — that responsibility now lives on the `zamadrop.xyz` landing page. Status filter switched from contract state-machine terms (`Setup`/`Finalize-pending`/`Claiming`) to user-facing `All`/`Live`/`Closed` via the new `frontend/src/lib/phase.ts` mapping (kept internal phase type intact). CampaignCard now leads with status + privacy badges, then declared total + recipients, then a `Your role` row (recipient identity comes from the existing `allocationSet(addr)` view inside `useRoleInfo`, no new on-chain reads), with admin/auditor/token demoted to grey footnote. Empty state now distinguishes truly empty `CAMPAIGNS` (`Create the first campaign` CTA) from filter-empty (`Clear filters` CTA). Connect-wallet logic factored into `frontend/src/lib/use-connect-wallet.ts` so `Home.startCampaign` and `CampaignCard.YourRoleRow` share one path.

Verification: `npm run lint` (no new errors; 6 pre-existing errors in `badge.tsx` / `button.tsx` / `fhevm.ts` untouched), `npm run build` green, `npx vitest run` 33/33 pass (9 new in `lib/phase.test.ts`), `openspec validate home-three-section-ia --type change` valid. Browser-level QA deferred to next handoff.

### P1 backlog (split from this change)

- TopBar shows `Create campaign` even when wallet not yet connected
- Contextual disclosure (claim / audit / wizard pages) for FHE privacy boundary, replacing the removed home sidebar
- User-intent filters (`My access` / `Created by me` / `Auditor access`) — pending FHE recipient-list privacy decision
- Visual system pass (card density, footer cleanup, etc.) — explicitly out of scope here

## 2026-05-07 (Wave 1 of ship session)

### Active Change

`openspec/changes/v7-dapp-wizard` — branch `feat/v7-e2e-and-ship`

### Wave 1 Outcome

Two commits ahead of `main`:
- `c18a8e5 feat(frontend): add Create Campaign CTA on Home + TopBar`
- `a63dab5 feat(scripts): migrate cli-setup.ts to V7 constructor signature`

Tasks closed: 1.1, 1.2, 3.2, 3.4. 57/57 contract tests green; frontend lint
baseline (10 errors in V6 SetAllocationForm) unchanged; frontend `npm run
build` succeeds.

### Backend smoke (4.5 + 6.4) — closed via local Postgres

Both tasks now `[x]` after switching from docker-pg to brew-installed
`postgresql@16`. Reason for the switch: host docker daemon was half-dead
(`docker ps` returned but `docker run` / `docker system df` hung > 2 min)
because `/System/Volumes/Data` was 96% full (18 GB free) — APFS throttling
the 60 GB `Docker.raw` IO. Backend smoke is a vitest + pg job, not worth
fighting Docker Desktop for.

How to reproduce locally:

```bash
brew services start postgresql@16
/opt/homebrew/opt/postgresql@16/bin/createdb zamadrop
# backend/.env DATABASE_URL must point at postgresql://localhost:5432/zamadrop
cd backend
set -a && source .env && set +a
npm run db:migrate            # → ✅ Schema applied (6 tables)
npm test                      # → 16/16 passing (auth, drafts, register)
npm run dev &                 # boots on :3002
curl -s http://localhost:3002/api/health   # → {"ok":true}
```

Indexer worker smoke (6.4): `indexerTick()` against local pg + Sepolia
RPC (`https://ethereum-sepolia-rpc.publicnode.com`) resolves all four
V7 event ABIs, polls a 1000-block window in ~1s, and advances
`kv_state['indexer.last_block']` correctly.

Followup found during smoke (not blocking ship): on a fresh DB,
`indexer.last_block` defaults to `0`, so the first tick tries to scan
from genesis to tip — public Sepolia RPCs reject this with a 50k
block-range cap. `register-campaign` should seed `kv_state` with
`deployed_at_block` (or worker should clamp `fromBlock` to
`tip - N`). File as a small followup issue post-ship.

### Next (Wave 2)

- 2.1 SKIPPED. The existing Sepolia deployment at
  `0xDAe72F548BFc37649c7Da24Cd0a2c90a73E6c5c1` was deployed 2026-05-05,
  predating tasks 2.9a/2.9b (State enum + cancelCampaign). Its ABI still
  has `bool finalized`, not `enum State` / `claimedTotalPlaintext` /
  `recipientListHash` / `allocationCount`. `scripts/e2e-sepolia.ts`
  expects V7 ABI, so it cannot run against the old campaign. Updating
  the script to deploy fresh would duplicate Wave 2.2 work; instead
  Wave 2.2 (wizard) deploys the fresh V7 campaign + drives the entire
  lifecycle, which is the more realistic test anyway.
- 2.2 Manual MetaMask wizard walkthrough on Sepolia. Frontend-only
  setup (backend deferred per Wave 1.3). Validates: V7 wizard 5 steps
  → real deploy → recipient claim → auditor verify → admin
  withdrawExcess. Records any rough edges to LEARNINGS / GitHub
  issues.

### Open Worktrees (cleanup later)

- `/Users/ernest/zamaDrop/.claude/worktrees/agent-a9b5b6d375b156e26` —
  Agent A's cli-setup migration worktree (commit cherry-copied; safe to
  `git worktree remove` when convenient).

### Risks

- Do not create a second competing source of truth for V7 behavior under
  `openspec/specs/` before the change is archived.
- Do not weaken KMS proof checks in `callbackFinalize` or `executeTransfer`.
- Do not change `claim()` ordering without preserving atomic rollback.
- Sepolia KMS callback is 1–3 blocks; wizard UI must tolerate the wait.

### Verification

`npm test` (root): 57/57 passing on this branch.
`cd frontend && npm run build`: succeeds (1 vite chunk-size warning, baseline).

