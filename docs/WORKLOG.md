# ZamaDrop Worklog

This file is for short-term handoff context. Keep it current, concise, and biased toward what the next human or model needs to know before continuing.

Do not duplicate OpenSpec tasks here. `openspec/changes/*/tasks.md` remains the source of truth for implementation checklists.

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

### Deferred (still `[~]` in tasks.md)

- 4.5 backend `db:migrate` smoke
- 6.4 indexer worker smoke

Reason: host docker daemon was unresponsive (CLI hung on `docker ps` even
with daemon process alive — likely macOS keychain credential helper
blocking). Not a code defect. Both tasks naturally validate the moment a
real campaign is registered against the deployed backend (Wave 2.2 path),
so re-running a local docker smoke would not improve signal before ship.

### Next (Wave 2)

- 2.1 `npx hardhat run scripts/e2e-sepolia.ts --network sepolia` — chain-only
  proof that contract → KMS → executor still works on Sepolia.
- 2.2 Manual MetaMask wizard walkthrough on Sepolia with admin + recipient2
  + auditor. Records any rough edges to LEARNINGS / GitHub issues.

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

