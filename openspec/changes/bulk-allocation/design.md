# bulk-allocation — design

## Decision summary

| Choice | Decision | Rationale |
|---|---|---|
| Batch primitive | `setAllocationsBatch(address[], externalEuint64[], bytes)` | One proof covers all amounts in batch (relayer SDK packing) — 10x calldata savings vs N independent proofs |
| Max batch size | **32 recipients per call** | Zama relayer SDK packing limit: `2048 bits / 64 bits per uint64 = 32`. Hard ceiling, not tunable. |
| Atomicity on failure | Whole batch reverts on any per-recipient guard failure | Matches V7 single-call semantics; partial state is harder to reason about than retrying a clean batch |
| Backwards compatibility | Keep `setAllocation` (single) intact | Admin tooling that fixes one allocation at a time still works; ABI addition only |
| Frontend routing | `N ≤ 5` uses single, `N > 5` uses batch | Small batches save no popups; avoid unnecessary code path for trivial cases |

## §1 — Why batch size 32 is hard, not soft

Two protocol-layer constraints determine the ceiling. We don't get to
pick a number; the math picks it for us.

### Constraint 1: Zama relayer SDK input-proof packing

From `node_modules/@zama-fhe/relayer-sdk/lib/web.js` (validated 2026-05-08):

```js
if (bits.length + 1 > 256)
    throw 'Packing more than 256 variables in a single input ciphertext is unsupported';
if (bits.reduce((acc, val) => acc + Math.max(2, val), 0) + added > 2048)
    throw 'Packing more than 2048 bits in a single input ciphertext is unsupported';
```

`uint64 = 64 bits → 2048 / 64 = 32` is the binding limit. The 256-
variable rule kicks in only for tiny types (bool/uint8 territory).

### Constraint 2: Sepolia block gas budget

Each `FHE.fromExternal(handle, proof)` runs an on-chain ZK proof
verification. Empirical cost: **~500k gas per recipient**.

| Batch | Gas | Sepolia 30M block utilisation |
|---|---|---|
| 32 | 16M | 53% |
| 50 | 25M | 83% (no margin for spikes) |
| 100 | 50M | exceeds block limit; unmineable |

So **32 is also the gas ceiling**, with comfortable headroom for
Sepolia base-fee spikes and any future FHE op gas regressions.

### Why "1 tx for N=100" is impossible regardless

Even with smart-wallet (AA) bundling, the on-chain transactions
themselves can't merge. 100 × 500k = 50M gas exceeds the 30M block
limit. Multiple txs across multiple blocks are physically required for
N > ~50. The smart-wallet layer reduces *signatures* to 1, not
*transactions* to 1.

## §2 — Contract sketch

```solidity
error ArrayLengthMismatch();

function setAllocationsBatch(
    address[] calldata recipients,
    externalEuint64[] calldata encAmounts,
    bytes calldata inputProof          // ONE proof for the whole batch
) external {
    if (msg.sender != admin) revert NotAdmin();
    if (state != State.Setup) revert NotSetup();
    if (recipients.length != encAmounts.length) revert ArrayLengthMismatch();

    for (uint256 i = 0; i < recipients.length; i++) {
        address r = recipients[i];
        if (allocationSet[r]) revert AllocationAlreadySet();

        euint64 amount = FHE.fromExternal(encAmounts[i], inputProof);
        _allocation[r] = amount;
        FHE.allowThis(_allocation[r]);
        FHE.allow(_allocation[r], r);

        _runningTotal = FHE.add(_runningTotal, amount);
        FHE.allowThis(_runningTotal);

        allocationSet[r] = true;
        allocationCount += 1;
        emit AllocationSet(r);
    }
}
```

Same per-recipient invariants as V7 single `setAllocation`. The loop
body is verbatim copy of the existing function's body; only the
function signature changes to take arrays.

## §3 — Frontend chunking pattern

```ts
const BATCH_SIZE = 32; // protocol-imposed, see Design §1

async function setAllocationsBatched(ctx, campaignAddress, recipients) {
  const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const chunk = recipients.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

    // Pack 1..32 amounts into a single proof.
    const buffer = ctx.fhevm.createEncryptedInput(
      getAddress(campaignAddress),
      getAddress(ctx.adminAddress),
    );
    chunk.forEach((r) => buffer.add64(r.amount));
    const ciphertexts = await buffer.encrypt();

    const tx = await ctx.walletClient.writeContract({
      abi: CAMPAIGN_ABI, address: campaignAddress,
      functionName: "setAllocationsBatch",
      args: [
        chunk.map((r) => r.address),
        ciphertexts.handles.map(toHex),
        toHex(ciphertexts.inputProof),
      ],
      account: ctx.adminAddress, chain: ctx.walletClient.chain,
    });
    await ctx.publicClient.waitForTransactionReceipt({ hash: tx });

    chunk.forEach((r) => ctx.onAllocated(r.address));
    ctx.onProgress(3,
      `${i + chunk.length}/${recipients.length} done (batch ${batchIndex}/${totalBatches})`);
  }
}
```

Resume support stays identical to V7's single-call path: the wizard
already tracks `allocatedSoFar` per recipient address; chunking just
filters out completed ones at the start of each new wizard run.

## §4 — Rejected alternatives

### 4.1 Smart wallet (AA / EIP-7702) for single-signature UX

**Approach**: admin uses a Safe / Argent / Zerodev / Pimlico smart
wallet. Signs one UserOperation that bundles 4-16 internal
`setAllocationsBatch` calls. Bundler dispatches them as separate txs.

**Result**: admin-side signing drops to **1 popup** for any N up to
the contract's recipientCount limit.

**Why rejected for this iteration**:
- 2-3 weeks integration work (bundler service, smart-wallet
  onboarding, paymaster setup if we cover gas, gas-cost overhead
  ~10-15% per UserOp)
- Ecosystem maturity: EIP-4337 adoption among non-crypto-native
  campaign operators (payroll admins, DAO contributors) is still
  early. Forcing them onto Safe / Argent before basic batching ships
  inverts the priority order.
- Trust-model shift: paymasters and bundlers introduce off-chain
  service dependencies, reminiscent of the executor daemon we just
  eliminated in ADR 0003. Want at least one product cycle of stable
  EOA-only operation first.
- Gas-wise: doesn't reduce **transactions**, only signatures. The
  block-gas math in §1 still requires ⌈N/32⌉ separate txs across
  multiple blocks, taking ~3 min wall-clock for N=500. Smart wallet
  hides the txs behind one popup but doesn't make them free.

**Future**: revisit as a separate OpenSpec change once two conditions
hold:
1. Smart-wallet adoption in target user persona ≥ ~30% (currently
   well below)
2. We have at least one V8/V9 smart-wallet-aware contract surface
   that benefits from session keys (e.g., recurring payroll campaigns)

### 4.2 Off-chain backend relayer (admin signs typed data, backend pays gas)

**Approach**: admin signs one EIP-712 typed message authorising a
batch. Backend's own EOA submits the actual `setAllocationsBatch`
txs. Contract verifies the EIP-712 signature on top of the existing
admin-only check.

**Result**: admin signs 1 typed message, all txs flow through backend.

**Why rejected**:
- Re-introduces the off-chain dependency we just eliminated in ADR
  0003 (executor service). Reverses the architectural direction
  documented in this same project last week.
- Backend operator becomes the gas payer + tx submitter — needs a
  funded EOA, monitoring, abuse limits. Real ops surface.
- Trust shift: admin's typed signature is reusable until expiry; if
  signed scope is loose, malicious backend could replay. Tightening
  scope cryptographically (per-batch nonce, per-recipient hash)
  reaches the complexity of just doing AA properly.

### 4.3 Off-chain Merkle commitment + recipient pull

**Approach**: admin builds a Merkle tree off-chain mapping
`(recipient, encrypted_handle)`. Submits 1 tx with the root. Recipient
at claim time provides their leaf + Merkle proof + FHE proof.

**Result**: admin signs 1 tx for any N. Recipient claim becomes
heavier but still feasible.

**Why rejected**:
- Sum check breaks: V7's `finalize()` requires summing all encrypted
  handles on chain. With Merkle, the handles are off-chain until each
  recipient claims. Can't do `FHE.eq(runningTotal, declaredTotal)`
  before any claims happen.
- Workaround: admin generates a SNARK proving "I committed N values
  with sum = declaredTotal under FHE." This is PhD-level
  cryptographic engineering, ~6 months scope.
- Loses V7's trustless sum-check property until the SNARK lands.

## §5 — Compatibility audit

| Existing invariant | bulk-allocation impact | Verified by |
|---|---|---|
| Allocations are append-only (`setAllocation` reverts twice) | ✅ unchanged — `allocationSet[r]` per-recipient flag still gates | test 2.4 (existing) + new test "duplicate within batch reverts" |
| `claim()` atomicity | ✅ unchanged — claim path untouched | existing 57 tests |
| `claimedTotal` only mutates in `claim()` | ✅ unchanged | existing |
| `allocationCount == recipientCount` finalize gate | ✅ unchanged — batch increments per recipient identically | existing finalize tests |
| `recipientListHash` immutability | ✅ unchanged — only constructor sets it | existing |
| KMS callback / active-pull (ADR 0003) | ✅ unchanged — separate code path | existing |

No existing test should fail. Coverage target ≥ 90% maintained.

## §6 — UX progression for the wizard

| Wizard state | V7 (now) | After bulk-allocation |
|---|---|---|
| Step 5.3 in flight, N=100 | "23/100 encrypting…" then sign popup, 100 times | "Batch 3/4 (78/100 done)" then sign popup, 4 times |
| Wallet popups for N=100 | 100 | 4 |
| Wall-clock for Step 5.3, N=100 | ~3-4 min (admin reaction-time bound) | ~50 s |
| Resume after wizard refresh | Tracks per-recipient via `allocatedSoFar` | Same — chunking pre-filters completed |
| Demo failure mode | "Admin gives up" | "Admin clicks Confirm 4 times" |

The change is product-defining for the 100-500 recipient sweet spot.
