# V8 finalize-recovery — design

## Decision summary

| Choice | Decision | Rationale |
|---|---|---|
| New terminal state | **`TimedOut` distinct from `Failed`** | Preserve `Failed` ≡ "KMS proved mismatch" semantic for auditors |
| Step count | **Two-step (TimedOut → cancelCampaign)** | Lets late KMS callback still rescue; simpler than three-step |
| Late KMS rescue | **`callbackFinalize` accepts TimedOut → Claiming** | If KMS finally arrives during the `TimedOut` window, recipients still get paid |
| Timeout duration | **constructor parameter, 1h default** | Sepolia 1h reflects empirical reality; mainnet pick 48-72h |
| Timestamp source | **`block.timestamp`** | Sufficient for hour/day windows; miner ±15s is irrelevant |
| Recipient consent | **None required** | Recipients aren't on-chain identities; cancellation only happens after KMS demonstrably failed |

## Alternatives rejected

### A. Single-step `adminTimeoutFail()` reusing `Failed`

The naive design we initially proposed. Codex review (2026-05-07) flagged
three High-severity issues:

1. **Admin rug lever** — admin can deploy + fund + valid allocations +
   finalize + wait 1h + force `Failed` + drain. Conflates "KMS proved
   sum wrong" (no obligation to recipients) with "admin got impatient"
   (real obligation may exist if KMS were healthy).
2. **Destroys late KMS** — once flipped to Failed, `callbackFinalize`
   cannot recover (state guard requires Finalizing).
3. **Auditor lies** — `Failed` no longer means what `campaign-contract`
   spec says it means.

Rejected. The two-step design directly addresses all three.

### B. Three-step (request → wait → execute)

Pattern: `requestTimeoutCancel()` after timeout T₁ emits intent, then
`executeTimeoutCancel()` after additional delay T₂ moves to Failed.
During T₂, KMS still has a final chance.

Considered but rejected: the two-step `TimedOut → Claiming` pathway
already gives KMS a "final chance" (between TimedOut and cancelCampaign).
Adding a third explicit step is more UX surface area without proportionate
safety gain.

### C. Recipient veto / auditor multisig

Considered but rejected:
- Recipients aren't on-chain identities (only `allocationSet[addr]` flag);
  recipient-side cancellation would require recipient registration which
  contradicts V7 privacy goals.
- Auditor multisig is a viable governance pattern for high-value
  campaigns but introduces single-point-of-trust shifted to auditor.
  Complicates V7's clear "Admin / Auditor / Recipient" three-role model.
  Defer to V9+ governance enhancements.

### D. ZK proof of sum (no KMS)

Admin generates a SNARK that "I committed N FHE-encrypted values whose
plaintext sum equals declaredTotal". On-chain SNARK verification replaces
KMS callback.

Rejected: PhD-level cryptographic engineering; ~6 month effort. Not V7/V8
scope.

## State transition diagram (V8)

```
                        ┌────────────────────────┐
                        ▼                        │
                     [Setup] ──finalize()──> [Finalizing] ──callbackFinalize(true)──> [Claiming]
                                                  │                                        │
                                       adminTimeoutCancel(after timeout)             cancelCampaign / withdrawExcess
                                                  │                                        │
                                                  ▼                                        ▼
                                              [TimedOut] ──callbackFinalize(true)──> [Claiming]
                                                  │
                                                  ├──callbackFinalize(false)──> [Failed]
                                                  └──cancelCampaign()─────────> [Failed]  ◀── irreversible cutoff
                                       
[Finalizing] ──callbackFinalize(false)──> [Failed]
[Failed] ──cancelCampaign()──> (admin gets balance, terminal)
```

## Security analysis

**Trustless sum check preserved**: admin can never push state to
`Claiming` — only KMS can, via valid `decryptionProof`. Time-locked
admin push only goes to `TimedOut` then optionally `Failed`.

**Late KMS rescue window**: between `adminTimeoutCancel()` and
`cancelCampaign()`, KMS truth still wins. This narrows the rug window to
"admin actively wants to cancel AND has executed both steps".

**Time-lock prevents racing healthy KMS**: 1-hour minimum on
testnet is well above the 1-3 block target latency; admin cannot
front-run a KMS that's only 30 seconds late.

**block.timestamp manipulation**: ±15s miner manipulation window is
irrelevant against an hour-scale lock.

**Reentrancy**: `adminTimeoutCancel` performs no external calls.
`cancelCampaign` calls `safeTransfer` after state mutation — already
safe in V7.

## Frontend wait UX (deploy.ts)

Current behavior (V7): wait 5 minutes, throw `FinalizeFailureError`.
Error copy says "use withdrawExcess or cancelCampaign" — both wrong
because state is still Finalizing where neither works.

V8 behavior:
- Default wait extended to **15 minutes** (matches Sepolia best-case +
  buffer; users uncomfortable waiting longer can navigate to admin
  page anyway since CampaignDetail reads chain directly)
- On timeout, UI shows actionable hints:
  - "If state is still Finalizing after 1 hour, the admin can use
    Force Timeout Cancel from the admin page."
  - "If state has transitioned to Claiming, recipients may now claim."
- Wizard does not block forever — surfaces a "Continue without
  waiting" button after 5 minutes, navigates to `/c/<address>?role=admin`.

## Indexer changes

Add event handler:

```ts
// FinalizeTimedOut(uint256,uint256)
case "FinalizeTimedOut":
  await query(
    `UPDATE campaigns SET state = 'timed_out' WHERE address = $1`,
    [event.address]
  );
  break;
```

Add `timed_out` to the allowed state CHECK constraint (or use enum). Home
page sections may display TimedOut campaigns separately from Failed for
auditor clarity.

## Migration & rollout

V7 ships first; this V8 change implemented immediately after.

Existing V7 campaigns on chain (including the orphans created during
2026-05-07 development) cannot be upgraded — they remain on the V7 ABI.
New campaigns deployed against the V8 contract get the recovery
capability.

Frontend should detect contract version (e.g. via try-call on
`finalizeEscapeTimeout()`) and only show the new buttons for V8
deployments.
