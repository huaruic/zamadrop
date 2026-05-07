# OpenSpec Usage For ZamaDrop

OpenSpec is the source of truth for substantial ZamaDrop changes. It preserves project context across humans, agents, models, and sessions.

## Current Layout

```text
openspec/
  config.yaml
  changes/
    v7-dapp-wizard/
      proposal.md
      design.md
      tasks.md
      specs/
    archive/
      ...
  specs/
    ...
```

`openspec/changes/` stores active and archived changes. `openspec/specs/` stores accepted long-lived capability specs after a change is archived.

## When To Create A Change

Create an OpenSpec change for:

- contract behavior changes;
- FHE ACL, KMS proof, finalize, claim, or active-pull callback changes;
- privacy boundary changes;
- frontend flows that affect admin, recipient, or auditor behavior;
- backend/indexer/API behavior;
- any change that needs explicit acceptance criteria.

Do not create a change for:

- typo fixes;
- formatting-only edits;
- narrow lint fixes;
- test-only refactors that do not change expected behavior.

## Required Artifacts

Each substantial change should contain:

```text
openspec/changes/<change-id>/
  proposal.md  # why, scope, impact
  design.md    # approach, decisions, trade-offs
  tasks.md     # implementation checklist
  specs/       # capability requirements and scenarios
```

## Agent Startup Order

Before changing core behavior, read:

1. `AGENTS.md`
2. `openspec list`
3. the active change `proposal.md`, `design.md`, and `tasks.md`
4. relevant files under the active change's `specs/`
5. relevant ADRs under `docs/ADR/`
6. relevant lessons in `docs/LEARNINGS.md`
7. the code

## Relationship To Other Memory Files

- `AGENTS.md`: long-lived project rules and invariants.
- `docs/ADR/`: decisions that should survive many OpenSpec changes.
- `docs/LEARNINGS.md`: debugging conclusions and pitfalls.
- `docs/WORKLOG.md`: current handoff state.

## Archiving

After a change ships, run the OpenSpec archive workflow so accepted capability specs move from `openspec/changes/<change-id>/specs/` into `openspec/specs/`.

For the current V7 work, do not manually copy the active specs into `openspec/specs/`; let archive create the authoritative accepted specs after implementation and verification.

