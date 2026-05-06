# ZamaDrop Worklog

This file is for short-term handoff context. Keep it current, concise, and biased toward what the next human or model needs to know before continuing.

Do not duplicate OpenSpec tasks here. `openspec/changes/*/tasks.md` remains the source of truth for implementation checklists.

## 2026-05-07

### Active Change

`openspec/changes/v7-dapp-wizard`

### Current State

- OpenSpec is the chosen workflow for substantial ZamaDrop changes.
- The active V7 change already contains `proposal.md`, `design.md`, `tasks.md`, and capability specs under `openspec/changes/v7-dapp-wizard/specs/`.
- Long-term ADR, learning, and handoff documents were added under `docs/`.
- `openspec/specs/` is intentionally not populated yet because V7 has not shipped. Per `tasks.md`, archiving `v7-dapp-wizard` after merge should migrate accepted specs into `openspec/specs/`.

### Next

- Continue implementing `v7-dapp-wizard` from `openspec/changes/v7-dapp-wizard/tasks.md`.
- Before code changes, read `AGENTS.md`, the V7 proposal/design/tasks, and any relevant capability spec.
- After each completed V7 task, update the corresponding checkbox in `tasks.md`.

### Risks

- Do not create a second competing source of truth for V7 behavior under `openspec/specs/` before the change is archived.
- Do not weaken KMS proof checks in `callbackFinalize` or `executeTransfer`.
- Do not change `claim()` ordering without preserving atomic rollback behavior.

### Verification

No code was changed in this documentation pass, so contract/frontend tests were not run.

