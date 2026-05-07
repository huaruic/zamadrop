# Architecture Decision Records

This directory stores long-lived technical decisions for ZamaDrop.

Use an ADR when a decision will affect multiple future changes, such as contract invariants, trust boundaries, privacy claims, deployment architecture, or MVP scope. Do not use ADRs for ordinary implementation notes; put short-lived handoff notes in `docs/WORKLOG.md` and debugging lessons in `docs/LEARNINGS.md`.

## Format

Create files named:

```text
0001-short-decision-title.md
0002-next-decision-title.md
```

Use `0000-template.md` as the starting point.

## Index

- [0001: Keep Executor Offchain And KMS-Gated](0001-keep-executor-offchain-and-kms-gated.md) — *operational guidance superseded by 0003*
- [0002: Use OpenSpec For Protocol And Product Changes](0002-use-openspec-for-protocol-and-product-changes.md)
- [0003: Frontend As Primary KMS-Callback Submitter](0003-frontend-as-primary-executor.md)

