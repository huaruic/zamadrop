# ZamaDrop Learnings

This file records debugging conclusions and project lessons that future agents should not rediscover from scratch. Keep entries short and factual. If an entry becomes a long-lived architectural rule, promote it to an ADR or `AGENTS.md`.

## bulk-allocation batch ceiling = 16 (HCU-bound, 2026-05-08)

### What

`setAllocationsBatch` packs up to 16 recipients per call. This is **not a number we picked** — it's the binding minimum of three protocol-layer constraints:

1. **FHEVM HCU (Homomorphic Computation Unit) per-tx budget** ← binding constraint. The loop body's `FHE.add(_runningTotal, amount)` consumes computation depth tracked by `HCULimit.sol`. Batches of 32 revert `HCUTransactionDepthLimitExceeded()` (empirically verified 2026-05-08). Batch of 16 is the largest size validated under the current FHE op pattern.
2. **Zama relayer SDK input-proof packing**: `createEncryptedInput()` rejects more than 2048 bits of packed values per proof (`node_modules/@zama-fhe/relayer-sdk/lib/web.js`). For uint64 amounts: `2048 / 64 = 32`. NOT binding here — HCU bites first.
3. **Sepolia block gas budget**: each `FHE.fromExternal` verify costs ~500k gas. A 16-recipient batch is ~8M gas (27% of 30M block limit). Plenty of margin.

The Solidity contract accepts arbitrarily-sized arrays; the limit is enforced upstream by client-side chunking (frontend wizard, CLI scripts). Bumping it requires either Zama raising the HCU budget or restructuring the loop to reduce FHE op depth — not a project-internal tunable.

### Why this matters for product

For N=500 recipient drops (the stated target market), batching collapses 500 wallet popups → ⌈500/16⌉ = 32 popups (~6 minutes wall-clock, mostly waiting for confirmations between txs). Without batching, N>50 drops are functionally undeployable on EOA wallets — 32 popups is annoying but completable; 500 popups is not.

### Rejected: smart-wallet "1 popup" UX in same iteration

Smart wallet (EIP-4337 / EIP-7702) can collapse the 16 batches into a single UserOperation = 1 admin signature. Deferred because:
- 2-3 weeks integration work (bundler + paymaster)
- Smart-wallet adoption among campaign operators / payroll admins still niche
- Doesn't reduce *transactions*, only signatures — 32 on-chain txs across multiple blocks are still required by HCU + gas math (N=500 case)
- Re-introduces off-chain service dependency (bundler) which we just eliminated in ADR 0003

Full rejected-alternatives analysis lives in `openspec/changes/bulk-allocation/design.md §4`. Revisit when smart-wallet adoption in target persona crosses ~30%.

## V7 wizard 5.5 — passive Gateway-push to active relayer pull (2026-05-08)

### Symptom

During Wave 2.2 of the V7 ship, deployed campaign
`0x5a20529d2c930CE73fdd299C10Db26E10D2FB80D` on Sepolia. setAllocations
× 2 and `finalize()` all succeeded; state entered `Finalizing`. After
**30+ minutes** the wizard reported "KMS callback did not arrive" and
threw `FinalizeFailureError(timeout)`. 600 ZDT escrowed and apparently
locked.

### Investigation result

The KMS Gateway was healthy the whole time. Running an active-pull
recovery script (`scripts/recover-stuck-finalize.ts`) returned the
decryption + signed proof in **3.7 seconds**:

```
[1/3] Asking relayer SDK to publicDecrypt the handle...
      Returned in 3.7s
      result: true
[2/3] Submitting callbackFinalize ourselves...
      tx: 0x1d2d2743... ✅ Success
[3/3] State after: Claiming
🎉 Campaign recovered.
```

Root cause: the wizard's `waitForClaiming` was passive — it polled
`state()` waiting for the Gateway to push `callbackFinalize`. Gateway's
event subscription on Sepolia is unreliable; if it misses the
`FinalizeRequested` event, no callback ever fires. The encrypted ebool
handle is on chain and `makePubliclyDecryptable`'d — anyone can ask the
Gateway to decrypt it and submit the callback. The wizard simply
wasn't doing this.

### Fix

`frontend/src/pages/wizard/deploy.ts`:

- Removed `waitForClaiming` (passive polling), `KMS_CALLBACK_TIMEOUT_MS`,
  `POLL_INTERVAL_MS`, `sleep()` helper.
- Added `pullAndCallback`: reads `finalizeCheckHandle` from contract,
  calls `ctx.fhevm.publicDecrypt([handle])` (with 3-attempt retry +
  5s backoff), submits `callbackFinalize(result, proof)` ourselves,
  tolerates state-already-advanced races.

End-to-end Step 5.5 latency now **~10-15s** (~3-10s relayer MPC +
~12s Sepolia block). No 5-minute timeout. No passive polling.

### Sepolia orphans created during this debugging cycle

- `0xb9f0a71be6ca4de909df15eb846128d7e84bb4e1` — Setup (0 ZDT, abandoned
  due to address-checksum bug on Step 5.3 before this fix).
- `0x2b0C786CeDE08AC3d06e1703e62F08b524911b1d` — Setup (600 ZDT, same
  checksum bug; ZDT funded but allocations never set; no recovery
  path in V7).
- `0x5a20529d2c930CE73fdd299C10Db26E10D2FB80D` — recovered to Claiming
  via active-pull script; tx `0x1d2d2743c9af03fe...` (block 10806890+).
  Used for Wave 2.2 Phase B/C live testing.

### V8 status

`openspec/changes/v8-finalize-recovery/` (TimedOut state +
adminTimeoutCancel escape hatch) remains useful for the **rare tail
case** where Gateway is truly unreachable for hours (network outage,
threshold validator quorum loss). Active pull handles the common
"missed event" failure mode; escape hatch handles the residual.

V8 priority drops from "ship-blocking safety hole" to "post-V7 quality
improvement" once active pull is in V7.

### Prevention

- **For any future async oracle integration**: prefer active pull
  (request-response) over passive event subscription as the primary
  data-flow direction. Push-callbacks are an optimization, not the
  trust root.
- **Wizard timing budgets**: any step that depends on an external
  service should report wall-clock latency to telemetry; a step
  budget of 30s+ should default to active retry, not passive wait.

## V7 wizard implementation gaps (2026-05-07)

### Symptom

During Wave 2.2 of the V7 ship, three drafted-but-unwired backend
integrations surfaced:

1. `frontend/src/pages/wizard/api.ts` (drafts client) — implemented per
   task 8.2, never called by any wizard step. Refresh during Steps 1-4
   wiped all draft state because zustand was in-memory only.
2. `POST /api/register-campaign` — implemented per task 5.6, never
   called by Step 5 success. Wizard-deployed campaigns invisible on
   Home until manually registered.
3. Address checksum: `viem`'s `receipt.contractAddress` returns
   lowercase from public Sepolia RPC. Zama relayer SDK
   `createEncryptedInput` rejects with strict `isChecksummedAddress`
   check. Step 5.3 setAllocation 100% fails on Sepolia until
   `getAddress()` normalization is applied.

### Cause

Tasks in `tasks.md` covered the API client implementations and contract
ABI but did not include the wire-up tasks ("call X from Y at moment Z").
Acceptance criteria for task 8.2 was "manual call round-trips amounts" —
unit-test scope, not integration.

### Fix

- `frontend/src/pages/wizard/state.ts` — added `zustand/middleware`
  persist with custom bigint replacer/reviver (commit `f9ecd95`). Steps
  1-4 survive refresh; Step 5 deploy progress intentionally not
  persisted.
- `frontend/src/pages/wizard/Step5Deploy.tsx` — wired
  `POST /api/register-campaign` after `setStatus("deployed")`,
  best-effort with non-blocking warning UI on failure (commit
  `e8522a2`).
- `frontend/src/pages/wizard/deploy.ts` — wrapped both `campaignAddress`
  and `adminAddress` in `getAddress()` from viem before passing to
  `createEncryptedInput` (commit `10ebf0c`).

### Prevention

When a task spec adds a backend endpoint or a frontend client module,
the same `tasks.md` should include explicit "wire-up" tasks with
end-to-end acceptance criteria (e.g. "deploy a campaign via wizard;
verify `campaigns` table contains a row within 5 seconds"). Surface
these gaps in `/plan-eng-review` instead of ship-time.



## fhEVM API uses `FHE`, not `TFHE`

### Symptom

Compilation fails or examples do not match project code when using `TFHE.xxx`.

### Cause

ZamaDrop uses `@fhevm/solidity ^0.11.1`, where the Solidity API is imported from `@fhevm/solidity/lib/FHE.sol` and called through `FHE.xxx`.

### Fix

Use:

```solidity
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
```

Valid helpers include `FHE.add`, `FHE.eq`, `FHE.allow`, `FHE.allowThis`, and `FHE.fromExternal`.

### Prevention

`AGENTS.md` explicitly forbids the old `TFHE.xxx` naming.

## KMS-callback caller is not an integrity trust root

### Symptom

It was tempting (in V5/V6) to treat `scripts/executor.ts` as a trusted
backend because it submits plaintext finalize and transfer results.

### Cause

The caller observes Gateway-decrypted values before relaying them
on-chain, but the contract verifies the KMS threshold signature before
accepting those values.

### Fix

Treat the caller as **liveness-only**, irrelevant to integrity.
Integrity belongs to `FHE.checkSignatures` in `callbackFinalize` and
`executeTransfer`. V7 builds on this insight: the same wallet that
triggers each flow self-submits the callback (frontend
`pullAndCallbackFinalize` / `pullAndExecuteTransfer`), so no separate
service is needed. See [ADR 0003](./ADR/0003-frontend-as-primary-executor.md).
The off-chain `scripts/executor.ts` daemon was deleted in V7 once the
frontend covered both happy-path callbacks.

### Prevention

When editing settlement flows, preserve proof passthrough and add tests
for forged bool / amount rejection. Do not introduce new "trusted
relayer" services — push callbacks to whichever wallet is already
authenticated for the surrounding flow.

## Claim privacy ends at settlement

### Symptom

Docs or UI copy may overstate ZamaDrop as fully private across the whole token lifecycle.

### Cause

Allocations are encrypted at rest, but ordinary ERC-20 transfers require a plaintext amount. After `executeTransfer`, calldata and `Transfer` events expose the claimed amount.

### Fix

Describe the product as allocation-at-rest privacy with public settlement accountability. Do not claim membership privacy or claim-time amount privacy for the MVP.

### Prevention

Keep privacy copy aligned with `docs/SECURITY.md` and the `privacy-boundary` OpenSpec capability.

## Use `bigint` for token amounts

### Symptom

Large token amounts can lose precision when parsed through JavaScript `Number`.

### Cause

ZamaDrop token amounts are integer values that can exceed the safe integer range of JS numbers.

### Fix

Parse user-entered amounts as strict unsigned integer strings and store/compare them as `bigint`.

### Prevention

Avoid `Number(...)` on user-typed amount strings. V7 tracks this in the `v7-dapp-wizard` change.

