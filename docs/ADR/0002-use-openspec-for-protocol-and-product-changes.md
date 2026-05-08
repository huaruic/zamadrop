# ADR 0002: Use OpenSpec For Protocol And Product Changes

## Status

Accepted

## Context

ZamaDrop is expected to be iterated by different humans and AI models. Chat history is not reliable project memory: it is incomplete, not versioned with code, and easy to lose when switching models or sessions.

The project has protocol-level invariants that must survive future changes:

- allocations can only be set once per recipient;
- `claim()` must remain atomic;
- claimed encrypted totals and plaintext settlement totals have strict update points;
- Gateway/KMS callback flows are asynchronous;
- MVP scope intentionally excludes Merkle proofs, vesting, factories, cross-chain flows, and KYC unless scope is explicitly changed.

## Decision

Use OpenSpec for every substantial protocol, product, frontend flow, KMS callback, backend, or trust-boundary change.

Each significant change SHOULD live under:

```text
openspec/changes/<change-id>/
  proposal.md
  design.md
  tasks.md
  specs/
```

Small mechanical edits, lint fixes, typo fixes, and narrow test-only changes do not require an OpenSpec change.

Once a change ships, archive it so the accepted specs become the authoritative long-lived behavior under `openspec/specs/`.

## Consequences

- Agents must read `AGENTS.md`, `openspec list`, the active change artifacts, and relevant docs before changing core behavior.
- OpenSpec specs become the contract between product intent, implementation, and tests.
- ADRs remain separate and record long-lived decisions that affect multiple OpenSpec changes.
- `docs/WORKLOG.md` records short-term handoff state and must not replace `tasks.md`.

## References

- [OpenSpec README](../../openspec/README.md)
- [AGENTS.md](../../AGENTS.md)
- [v7-dapp-wizard proposal](../../openspec/changes/v7-dapp-wizard/proposal.md)

