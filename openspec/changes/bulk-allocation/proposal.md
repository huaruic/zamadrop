# bulk-allocation — batched setAllocation for medium-to-large drops

## Why

V7 ships `setAllocation(address, externalEuint64, bytes)` as the only
allocation primitive: one recipient per call, one wallet signature per
recipient.

| Recipients (N) | Admin wallet popups | Wall-clock |
|---|---|---|
| 5 | 5 | ~30 s |
| 50 | 50 | ~5 min of mashing Confirm |
| **500** | **500** | **completely unusable** |

The product target case (per the May-2026 design discussion) is
**N = 100 to 500 recipients**. The current architecture makes that
literally undoable — admin would give up before campaign deploys.

This is a real product blocker for production use, not a theoretical
optimization.

## What changes

Add `setAllocationsBatch(address[], externalEuint64[], bytes)` to the
campaign contract. Admin packs up to **32 recipients per call** (the
hard ceiling imposed by the Zama relayer SDK's input-proof packing
limit, see Design §1). Frontend wizard Step 5.3 chunks the recipient
list into batches of 32 and submits one tx per chunk.

Result:

| Recipients (N) | Wallet popups (after) | Wall-clock |
|---|---|---|
| 5 | 1 | ~10 s |
| 50 | 2 | ~30 s |
| 100 | 4 | ~50 s |
| **500** | **16** | **~3 min** |

Strictly additive. The single-recipient `setAllocation` stays for
admin tooling that needs to fix one allocation at a time.

## Impact

### Affected capabilities
- `campaign-contract` — adds `setAllocationsBatch` function + new
  `ArrayLengthMismatch` error. All existing invariants preserved
  (per-recipient `allocationSet[]` dedupe, `allocationCount` bump,
  `_runningTotal` accumulation).

### Affected code
- `contracts/ZamaDropCampaign.sol` — ~30 lines added
- `test/ZamaDropCampaign.test.ts` — ~6-7 new test cases
- `frontend/src/abis/*` — ABI re-export (one new function + one new error)
- `frontend/src/pages/wizard/deploy.ts` — new `setAllocationsBatched`
  helper; Step 5.3 routes through it when `N > 5`
- `scripts/cli-setup.ts` — same chunking logic on the node-side path
- `docs/SECURITY.md` — note that batch size is bounded by FHE protocol
  + EVM block gas, not a tunable

### Migration
Pure ABI addition. Existing V7 deployments and the recently-archived
`v7-dapp-wizard` capability specs stay valid — this change adds a
delta requirement to `campaign-contract`, doesn't modify existing ones.

## Out of scope (future iterations)

The deeper "1 wallet signature regardless of N" goal needs a smart-
wallet layer (EIP-4337 account abstraction or EIP-7702 delegated EOA).
That is **not feasible in this change**:

- AA/4337 integration: 2-3 weeks (bundler service, smart-wallet
  onboarding, gas-cost overhead, paymaster setup)
- EIP-7702: ~1 week but newer/less battle-tested
- Both shift the trust / UX model significantly

Documented in `design.md` §"Rejected alternatives" + LEARNINGS as a
deliberate deferral. Revisit when smart-wallet adoption among the
target user persona (campaign operators, payroll admins) crosses the
"this is normal" threshold — currently still niche.

## Sequencing

This is the next active OpenSpec change after V7 ship. Independent of
`v8-finalize-recovery` (escape hatch) — they touch different
contract surfaces and can ship in either order. This one has higher
product impact (unblocks the 100-500 recipient case), so prioritize.

Estimated work: 6-7 hours.
