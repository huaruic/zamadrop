# ZamaDrop Learnings

This file records debugging conclusions and project lessons that future agents should not rediscover from scratch. Keep entries short and factual. If an entry becomes a long-lived architectural rule, promote it to an ADR or `AGENTS.md`.

## V7 Sepolia e2e — KMS callback can stall 30+ minutes (2026-05-07)

### Symptom

During Wave 2.2 of the V7 ship, deployed campaign
`0x5a20529d2c930CE73fdd299C10Db26E10D2FB80D` on Sepolia. setAllocations
× 2 and `finalize()` all succeeded; state entered `Finalizing`. After
**30+ minutes** the Zama KMS gateway never delivered
`callbackFinalize()`. State remained Finalizing, 600 ZDT permanently
locked: `claim`, `withdrawExcess`, and `cancelCampaign` all gated on
incompatible states; `setAllocation`/`finalize` also locked out.

The wizard's 5-minute timeout fired with `FinalizeFailureError` whose
remediation copy ("use withdrawExcess or cancelCampaign") was misleading
because both require state ≠ Finalizing.

### Cause

V7's contract has no escape hatch from `Finalizing`. The state machine
treats KMS callback as the only exit, on the assumption that the
gateway will always deliver within 1-3 blocks per AGENTS.md. Empirically
on Sepolia testnet, KMS occasionally stalls indefinitely (likely
threshold validator quorum / RPC subscription / network congestion).

Three Sepolia campaigns were created during V7 testing with locked
funds totaling ~1200 ZDT (testnet, harmless dollars-wise but
illustrative of the production risk):

- `0xb9f0a71be6ca4de909df15eb846128d7e84bb4e1` — Setup (0 ZDT, abandoned
  due to address-checksum bug on Step 5.3)
- `0x2b0C786CeDE08AC3d06e1703e62F08b524911b1d` — Setup (600 ZDT, same
  bug; ZDT funded but allocations never set)
- `0x5a20529d2c930CE73fdd299C10Db26E10D2FB80D` — Finalizing (600 ZDT,
  KMS never returned)

### Fix

Two layers, separately tracked:

1. **Immediate (V7 ship)**: document the limitation in PR risks and
   `docs/SECURITY.md`. Recommend pre-finalizing 1+ hour before any
   demo on Sepolia. Do not rely on V7 for production fund custody until
   V8 ships.

2. **V8 design (`openspec/changes/v8-finalize-recovery/`)**: add a
   distinct `TimedOut` state, `adminTimeoutCancel()` admin escape
   hatch, modified `callbackFinalize` and `cancelCampaign` guards to
   support late KMS rescue, and a constructor parameter for the
   timeout duration. Codex review (Codex session
   `019e01e1-a2c1-76f3-846f-8740901cfb16`) flagged three High-severity
   flaws in a naive single-step `Failed`-reuse design that the
   two-step `TimedOut → Failed` design avoids.

### Prevention

- AGENTS.md note about "demos should finalize ahead of time" is too
  weak; treat KMS callback as **best-effort with no SLA on testnet**.
- Future contract changes that introduce async oracle dependencies
  must include an explicit timeout/escape mechanism in the spec from
  day one.
- Wizard UX must not block forever on async events; surface "continue
  to admin view" + "still processing" affordances within minutes, not
  hours.

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

## Executor is not an integrity trust root

### Symptom

It is tempting to treat `scripts/executor.ts` as a trusted backend because it submits plaintext finalize and transfer results.

### Cause

The executor observes Gateway decrypted values before relaying them onchain, but the contract verifies the KMS threshold signature before accepting those values.

### Fix

Model the executor as a liveness component only. Integrity belongs to `FHE.checkSignatures` in `callbackFinalize` and `executeTransfer`.

### Prevention

When editing settlement flows, preserve proof passthrough and add tests for forged bool or amount rejection.

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

