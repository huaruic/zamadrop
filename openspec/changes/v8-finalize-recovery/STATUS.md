# v8-finalize-recovery — STATUS: DEFERRED

**Last updated**: 2026-05-09
**Decision**: defer to mainnet readiness
**Owner**: tracked as long-tail safety net, not blocked on this

## Why deferred

V7 active-pull KMS verification (shipped in PR #1, see `frontend/src/lib/kms-active-pull.ts` + `pullAndCallbackFinalize`) covers the dominant failure mode that motivated this change — Sepolia Gateway "missed event" stalls. Empirically that's compressed 30+ minute deadlocks down to ~10-15s.

The remaining edge case this change targets — Zama KMS Gateway being **truly unreachable for hours** (network partition, threshold validator quorum loss, Zama infrastructure outage) — is a tail risk that:

1. Has not been observed in V7 active-pull operation since 2026-05-08 (active-pull failure mode = retryable, not deadlocked)
2. Is acceptable for v0.x testnet/demo positioning where lost campaigns can simply be redeployed
3. Becomes ship-blocking only when ZamaDrop targets **mainnet with real funds**, which is on the v1 roadmap, not v0.x

## What's documented as the current limitation

`docs/SECURITY.md` §8.6 records the known boundary: if KMS Gateway is unreachable beyond active-pull retry/backoff scope, a campaign in `Finalizing` state cannot be unlocked. Recovery requires either Gateway returning, or this change shipping.

## When to revisit

Revive this change when **any** of these hold:

- ZamaDrop is being deployed to mainnet with non-trivial campaign funds
- Zama publishes a mainnet KMS SLA (informs the `finalizeEscapeTimeout` constructor default — testnet 1 hour vs mainnet 48-72 hours)
- A second KMS Gateway prolonged-outage incident occurs on a campaign with non-trivial value

At that point this change's `proposal.md` / `design.md` / `tasks.md` / `specs/` are still load-bearing — the design has been Codex-reviewed (which is why `TimedOut` is a separate state from `Failed`, preserving auditor-honesty semantics). Task estimate from `proposal.md`: 6-8 hours; can be scoped down to ~3 hours if the late-KMS-preservation path is dropped (admin rage-quit only, no `TimedOut → Claiming` recovery).

## What stays in this directory

- `proposal.md` — the "why" intact (with a banner pointing to this STATUS.md)
- `design.md` — including the rejected-alternatives analysis and Codex review conclusions
- `tasks.md` — the 44-task implementation breakdown
- `specs/campaign-contract/` — the spec delta against the current `campaign-contract` capability

Nothing is being deleted. This is a **deferred-but-designed** change, not an abandoned one.
