# ADR 0003: Frontend as Primary KMS-Callback Submitter

## Status

Accepted (2026-05-08). Supersedes the implementation guidance in ADR
0001 — the cryptographic trust root analysis there remains correct, but
the operational model "off-chain executor as the primary settlement
caller" is replaced.

## Context

ZamaDrop has two async KMS-callback paths:

- `finalize()` emits `FinalizeRequested(handle)`; eventually
  `callbackFinalize(result, proof)` settles state
  `Finalizing → Claiming/Failed`.
- `claim()` emits `ClaimRequested(user, handle)`; eventually
  `executeTransfer(user, amount, proof)` settles the ERC-20 transfer
  and sets `transferred[user] = true`.

ADR 0001 established that `FHE.checkSignatures(handle, abi.encode(value), proof)`
is the integrity trust root. **Caller identity is irrelevant** — anyone
holding a valid Gateway-signed proof can submit the callback. The ADR
explicitly anticipates the recipient, admin, auditor, or any third
party as legitimate callers.

The original V5/V6 implementation leaned on `scripts/executor.ts`, an
off-chain Hardhat script that subscribes to events, calls
`hre.fhevm.publicDecrypt`, and submits the callbacks. The V7 dApp
preserved this assumption: `RecipientPage`, `ClaimStepper`, and
`FinalizePanel` all submit only the user-facing transaction
(`finalize` / `claim`) and then **passively poll** for the executor's
callback to land.

### What we observed (2026-05-07/08 Sepolia)

The passive-polling model fails frequently in practice:

- **Wizard 5.5 stalls.** Campaign `0x5a20…80D` deployed cleanly,
  finalize() succeeded, but `callbackFinalize` never arrived for **30+
  minutes**. Running `scripts/recover-stuck-finalize.ts` (active pull)
  retrieved the proof in **3.7 seconds** and lifted state to Claiming
  on the same block.
- **Recipient claim stalls.** Without `npm run executor` running,
  `transferred[me]` never flips. The recipient's view is stuck on
  "Awaiting settlement" forever.

Root cause: the Zama Gateway's event-subscription path is not
covered by an SLA. RPC subscription drops, threshold validator quorum
hiccups, and operator forgetfulness all manifest as the same symptom —
a permanently pending campaign or claim, even though the encrypted
handle is on chain and `makePubliclyDecryptable`'d.

## Decision

The **frontend (and any first-party caller) is the primary KMS-callback
submitter**. Each user-initiated flow submits the full chain of
callbacks itself, in the same UX session, using
`relayer-sdk.publicDecrypt` (browser) or `hre.fhevm.publicDecrypt`
(node) to actively pull the threshold-MPC-signed result.

Concretely:

| Flow | Wallet that signs callback | Util |
|---|---|---|
| Wizard Step 5.5 finalize | Admin (already in flow) | `pullAndCallbackFinalize` |
| AdminPage FinalizePanel | Admin | `pullAndCallbackFinalize` |
| RecipientPage claim Step 2 | Recipient (pays own settlement gas) | `pullAndExecuteTransfer` |
| Local hardhat / Sepolia CLI smoke | The hardhat signer | `hre.fhevm.publicDecrypt` |
| Operational rescue of stuck campaigns | Any signer | `scripts/recover-stuck-finalize.ts` |

Shared utility: `frontend/src/lib/kms-active-pull.ts`. 3-attempt retry
with 5s backoff against the relayer SDK; race-safe against concurrent
pushes (re-reads state if our submit reverts and trusts on-chain truth).

The off-chain `scripts/executor.ts` daemon is **deleted** along with
its `npm run executor` / `npm run executor:local` scripts. Its
responsibilities were already covered by:

- Frontend active pull for both happy-path callbacks
- `scripts/recover-stuck-finalize.ts` for the rare case where state
  needs nudging without a frontend in the loop

## Consequences

### Positive

- **No hidden production dependency.** Deploying ZamaDrop no longer
  requires standing up a long-running executor service.
- **Deterministic latency.** Step 5.5 and claim Step 2 both complete
  in ~10–15 seconds (3–10s relayer MPC + ~12s block) instead of the
  long-tailed "1–3 blocks normally, 30+ min on a bad day" passive
  model.
- **Better economic alignment.** Recipients pay ~50k gas to settle
  their own ERC-20 transfer. Admins pay the callbackFinalize gas. No
  cross-subsidy via shared executor wallet.
- **Same trust model.** ADR 0001's analysis still holds: a malicious
  caller cannot forge proofs because `FHE.checkSignatures` rejects
  them. We are not weakening any guarantee, just moving who pushes the
  button.

### Negative / costs

- **Recipient signs two transactions** instead of one. The first signs
  `claim()`, the second signs `executeTransfer(...)`. The popups arrive
  back-to-back (~10 seconds apart while we publicDecrypt).
- **Admin signs two transactions** during finalize. Same UX cost as
  recipient.
- **Concurrent-pusher race** can revert one submission. Handled in the
  shared util by re-reading state and treating "already advanced" as
  success.

### Liveness gap and V8

If the Gateway is **truly unreachable for hours** (network outage,
threshold quorum unrecoverable), the frontend retry budget will give
up. The campaign is then stuck Finalizing with funds escrowed and no
recovery path in V7. This is the residual case
`openspec/changes/v8-finalize-recovery/` addresses with the
`adminTimeoutCancel()` + `TimedOut` state pattern.

V8's escape hatch becomes a **rare-tail safety net**, not a critical
path component, because active pull catches the common
"missed-event-subscription" failure mode that motivated V8 in the
first place.

## References

- [ADR 0001](./0001-keep-executor-offchain-and-kms-gated.md) — trust
  root analysis (still applicable)
- [LEARNINGS.md](../LEARNINGS.md) — empirical Sepolia 30+ min stall
  data + 3.7s active-pull recovery
- [`frontend/src/lib/kms-active-pull.ts`](../../frontend/src/lib/kms-active-pull.ts) —
  shared util implementation
- [`scripts/recover-stuck-finalize.ts`](../../scripts/recover-stuck-finalize.ts) —
  CLI rescue tool that demonstrated the pattern
- [`openspec/changes/v8-finalize-recovery/`](../../openspec/changes/v8-finalize-recovery/) —
  V8 escape hatch for the residual Gateway-truly-down case
