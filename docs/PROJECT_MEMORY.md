# Project Memory Model

This document explains how ZamaDrop preserves project context across coding agents, models, sessions, and future team members.

The source of truth is the repository, not chat history. Agents should read the right layer for the kind of context they need instead of loading every document blindly.

## Layers

```text
Permanent rules        -> AGENTS.md
Human entry points     -> README.md / README.zh-CN.md
Model-specific hints   -> CLAUDE.md / GEMINI.md
Current changes        -> openspec/changes/*
Accepted behavior      -> openspec/specs/*
Long-lived decisions   -> docs/ADR/*
Security boundaries    -> docs/SECURITY.md
Debugging lessons      -> docs/LEARNINGS.md
Short-term handoff     -> docs/WORKLOG.md
Product baseline       -> docs/product/prd.en.md / docs/product/prd.zh-CN.md
Operational runbooks   -> docs/RUNBOOKS/*
Test strategy          -> test/TEST_PLAN.md
Subsystem guides       -> frontend/README.md
Historical changes     -> openspec/changes/archive/* (read-only, not current truth)
Generated scratch      -> .private/* only; docs/superpowers/* is banned and .gitignore'd
```

## Read Policy

Do not load every retained document on startup.

- Read PRD files only for product positioning, scope, copy, or roadmap work.
- Read runbooks only for deploy, operations, or testnet validation work.
- Read `test/TEST_PLAN.md` only for test planning or QA work.
- Read subsystem guides only when working inside that subsystem.
- Do not use `openspec/changes/archive/*` as current truth; archives are historical evidence.
- Do not create or commit agent-generated scratch documents under `docs/`.

## Agent Startup Order

Before changing core behavior, read:

1. `AGENTS.md`
2. `openspec list`
3. the active change's `proposal.md`, `design.md`, and `tasks.md`
4. relevant specs under `openspec/changes/<change-id>/specs/`
5. relevant ADRs under `docs/ADR/`
6. relevant lessons in `docs/LEARNINGS.md`
7. the code

For small typo, lint, or narrow test-only changes, this full sequence is not required.

## File Responsibilities

### `AGENTS.md`

Project constitution for all coding agents.

Contains:

- project summary;
- required validation commands;
- FHE API naming rules;
- core contract and important functions;
- critical invariants;
- frontend and executor commands;
- MVP non-goals;
- trust assumptions;
- memory entry points.

Reason:

This is the first file agents should trust for long-lived rules. Keep it short, stable, and directive.

### `README.md` and `README.zh-CN.md`

Human-facing project entry points.

Contains:

- project overview;
- setup and run instructions;
- demo/deployment notes;
- user-facing framing.

Reason:

README files are for humans and reviewers. They should explain what the project is and how to use it, but should not carry every agent rule.

### `CLAUDE.md` and `GEMINI.md`

Model-specific compatibility files.

Contains:

- hints that specific tools or models may auto-load;
- model-specific reminders when needed.

Reason:

Different coding agents may look for different filenames. These files can exist for compatibility, but `AGENTS.md` should remain the primary shared rule source.

### `openspec/README.md`

OpenSpec operating guide for this repository.

Contains:

- when to create an OpenSpec change;
- required change artifacts;
- agent startup order;
- relationship between OpenSpec and docs memory files;
- archive expectations.

Reason:

OpenSpec is the main change-context system. This file explains how ZamaDrop uses it.

### `openspec/config.yaml`

OpenSpec project context and artifact rules.

Contains:

- project stack and domain;
- FHE API constraints;
- critical contract invariants;
- MVP non-goals;
- proposal/design/tasks rules.

Reason:

OpenSpec tooling and agents can use this to create consistent proposals, designs, and task lists.

### `openspec/changes/<change-id>/proposal.md`

The reason and scope for one active change.

Contains:

- why the change exists;
- what changes;
- affected capabilities;
- impact areas;
- non-goals.

Reason:

Agents should not infer product intent from code alone. The proposal explains why the work exists.

### `openspec/changes/<change-id>/design.md`

The technical design for one active change.

Contains:

- context;
- goals and non-goals;
- decisions;
- alternatives considered;
- risks and trade-offs;
- migration plan;
- open questions.

Reason:

Design files prevent future agents from re-litigating decisions or accidentally undoing important trade-offs.

### `openspec/changes/<change-id>/tasks.md`

The implementation checklist for one active change.

Contains:

- ordered tasks;
- validation requirements;
- tests or manual checks;
- ship/archive steps.

Reason:

This is the source of truth for active change progress. Do not duplicate detailed task checklists in `docs/WORKLOG.md`.

### `openspec/changes/<change-id>/specs/*/spec.md`

Behavioral requirements for one active change.

Contains:

- requirements;
- scenarios;
- acceptance criteria;
- role-specific behavior.

Reason:

Specs turn product intent into verifiable behavior. Tests and implementation should align with these files.

### `openspec/specs/`

Accepted long-lived system behavior.

Contains:

- specs from completed and archived changes;
- authoritative capability behavior for the current system.

Reason:

Active change specs are proposals until the change ships. Accepted specs belong here only after archive, avoiding two competing truths.

### `docs/SECURITY.md`

Security and trust model.

Contains:

- roles and capabilities;
- confidentiality boundaries;
- integrity boundaries;
- KMS/Gateway proof model;
- executor compromise analysis;
- plaintext lifecycle;
- historical gaps and hardening notes.

Reason:

ZamaDrop's complexity is mostly in trust boundaries, not raw code size. This file anchors security-sensitive reasoning.

### `docs/ADR/`

Architecture Decision Records.

Contains:

- long-lived decisions;
- context;
- chosen approach;
- consequences;
- references.

Reason:

OpenSpec records one change. ADR records decisions that should affect many future changes.

### `docs/LEARNINGS.md`

Debugging and implementation lessons.

Contains:

- known pitfalls;
- symptoms;
- causes;
- fixes;
- prevention notes.

Reason:

This file prevents agents from rediscovering the same bugs, such as using `TFHE.xxx`, trusting the executor for integrity, overstating privacy, or parsing token amounts with `Number`.

### `docs/WORKLOG.md`

Short-term handoff state.

Contains:

- active change;
- current state;
- next steps;
- current risks;
- recent verification notes.

Reason:

This file helps a new session resume work quickly. It should stay concise and should not replace OpenSpec tasks.

### `docs/product/`

Product baseline documents.

Contains:

- product positioning;
- user roles and scenarios;
- MVP scope;
- success criteria;
- long-term roadmap framing.

Reason:

PRDs explain why the product exists, but they are not implementation checklists.
Behavior changes still go through OpenSpec.

### `docs/RUNBOOKS/`

Operational procedures.

Contains deployment, validation, incident, and demo runbooks.

Reason:

Runbooks are task-specific instructions. They should not be mixed with
security boundaries, ADRs, or active change specs.

### `test/TEST_PLAN.md`

Canonical test strategy.

Contains:

- Hardhat / fhEVM mock coverage expectations;
- frontend no-wallet smoke coverage;
- MetaMask / Synpress wallet E2E strategy (merged from docs/metamask-automation-plan.md);
- known flaky or conditional testnet checks.

Reason:

Testing strategy cuts across contract, frontend, and executor work. Keep it
in one place instead of scattering test plans under `docs/`.

### Scratch Documents

Agent-generated plans, brainstorming notes, and temporary specs must not live
under `docs/`. Use `.private/` for local scratch. If the content should survive,
promote it into one of:

- `openspec/changes/<change-id>/`
- `docs/ADR/`
- `docs/LEARNINGS.md`
- `docs/WORKLOG.md`

## When To Update What

```text
New core behavior        -> OpenSpec change
Accepted behavior ships  -> archive into openspec/specs/
Long-lived decision      -> docs/ADR/
Security/trust change    -> docs/SECURITY.md and OpenSpec
Repeated bug/pitfall     -> docs/LEARNINGS.md
Session handoff          -> docs/WORKLOG.md
Permanent agent rule     -> AGENTS.md
Human setup/docs change  -> README or docs/*
Deployment / runbook     -> docs/RUNBOOKS/
Test strategy / E2E      -> test/TEST_PLAN.md
Product baseline change  -> docs/product/
```

## Current Project Scale

ZamaDrop is a medium-complexity FHE/Web3 dApp. The codebase is not huge, but the context is safety-sensitive.

Approximate useful context size:

- core business code: under 10k lines;
- Solidity contracts: a few hundred lines;
- frontend: several thousand lines;
- scripts/executor/deploy: around 1k lines;
- tests: several hundred lines;
- docs/OpenSpec/decision memory: around 8k-12k lines, including active planning docs.

Because the project is below the threshold where a vector database is necessary, the recommended approach is version-controlled context first: `AGENTS.md + OpenSpec + ADR + LEARNINGS + WORKLOG`.

## Guiding Principle

Prefer accuracy over automation.

Use lightweight repo-local automation and conventions to point agents at the right context, but keep the source of truth explicit, reviewed, and version-controlled.

