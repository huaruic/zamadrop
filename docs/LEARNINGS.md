# ZamaDrop Learnings

This file records debugging conclusions and project lessons that future agents should not rediscover from scratch. Keep entries short and factual. If an entry becomes a long-lived architectural rule, promote it to an ADR or `AGENTS.md`.

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

