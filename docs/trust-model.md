# Trust Model

> ZamaDrop is shipped as a **v0.x demonstration** of confidential token
> distribution on Zama fhEVM. This document inventories the trust
> assumptions baked into the v0.x contract surface and the migration
> path to a v1 release with hardened authorization.

🌐 [中文 (TODO)] | English

## 1. Overview

ZamaDrop v0.x is a reference implementation that proves the core
"private allocations, public accountability" pattern: per-recipient
amounts are stored as `euint64` ciphertexts, while the campaign-level
total is verified in the encrypted domain via `FHE.eq`. To keep the
implementation focused on the FHE flow, the v0.x contract leaves two
authorization paths intentionally open and runs the demo deployment
with overlapping role wallets. Production deployments require the
v1 hardening described in section 4 before handling real value.

## 2. Roles

| Role | Identity | Capability |
|---|---|---|
| Admin | Wallet stored at `admin()` (set to `msg.sender` in the constructor) | Calls `setAllocation`, `finalize`. Cannot decrypt individual allocations or `claimedTotal`. |
| Recipient | Wallet whose `allocationSet[addr]` is `true` | Calls `requestMyAllocation` to receive a re-encryptable handle for its own amount. Calls `claim` exactly once after `finalized == true`. |
| Auditor | Wallet stored at `auditor()` (set in the constructor) | Calls `requestClaimedTotalForAuditor` to retrieve the `claimedTotal` handle and re-encrypts it under its own key. Sees only the aggregate. |
| Public | Anyone reading public state or events | Reads `declaredTotal`, `recipientCount`, `finalized`, `claimed[addr]`, `transferred[addr]`, `finalizeCheckHandle`, `pendingClaimHandle[addr]`, and all emitted events. Cannot decrypt any individual `euint64`. |
| Executor (system) | Off-chain service consuming Gateway-decrypted handles | Calls `callbackFinalize(bool)` after publicly decrypting `finalizeCheckHandle`, and `executeTransfer(address,uint64)` after publicly decrypting `pendingClaimHandle[user]`. Not a user-facing role. |

## 3. v0.x Trust Assumptions

### 3.1 `callbackFinalize(bool result)` is permissionless

**What this means**: Any externally-owned account may invoke
`callbackFinalize` once `finalize()` has emitted `FinalizeRequested`
and exposed `finalizeCheckHandle`. The contract writes the supplied
boolean directly into the `finalized` storage slot.

**Why this is acceptable in v0.x**:
- The boolean argument must match the value the Zama Gateway publicly
  decrypts from `finalizeCheckHandle`. Since `finalizeCheckHandle` is
  produced by `FHE.eq(_runningTotal, encDeclared)` and marked publicly
  decryptable, any honest caller will compute the same result.
- A dishonest caller that flips the bit cannot extract value: setting
  `finalized = true` when totals do not match still gates `claim()`
  on `allocationSet[msg.sender]`, so non-recipients cannot drain the
  escrow. The remaining failure surface is denial-of-service on the
  campaign lifecycle, not loss of funds.
- The escrow balance is bounded by `declaredTotal` (admin transfers
  exactly that many tokens before claiming opens), so even a maximally
  adversarial finalize callback cannot move tokens that are not owed.

**Failure mode**: A griefer can force-finalize a campaign where the
totals do not actually match, which would cause downstream
`executeTransfer` calls to either underpay (if `runningTotal <
declaredTotal`, escrow has slack) or revert mid-distribution (if
`runningTotal > declaredTotal`, escrow runs dry before all recipients
are paid). Either case requires the admin to redeploy.

**Test coverage**: see `test/ZamaDropCampaign.test.ts`
"MVP 假设下，非 admin 也可调用 callbackFinalize" (line 166).

### 3.2 `executeTransfer(address recipient, uint64 amount)` is permissionless

**What this means**: Once a recipient has called `claim()`, the
contract stores `pendingClaimHandle[recipient]` and marks the
allocation ciphertext as publicly decryptable. Any account may then
call `executeTransfer(recipient, amount)` with the decrypted amount.
The contract validates `claimed[recipient] && !transferred[recipient]`
but does not validate the caller, nor does it cross-check `amount`
against the on-chain ciphertext.

**Why this is acceptable in v0.x**:
- `transferred[recipient]` is flipped before `token.transfer`,
  preventing replay or double-pay against a single claim.
- The escrowed token balance was funded only with `declaredTotal`,
  so an attacker who supplies an inflated `amount` exhausts escrow
  and triggers the `require(token.transfer(...))` revert; the call
  reverts atomically and `transferred[recipient]` is rolled back.
- The honest off-chain executor reads `pendingClaimHandle[recipient]`,
  publicly decrypts it via the Zama Gateway, and submits the decrypted
  value. Under that operating assumption the caller identity is
  irrelevant.

**Failure mode**: A griefer who decrypts `pendingClaimHandle[recipient]`
honestly but front-runs the legitimate executor still pays the
recipient the correct amount; only the gas attribution changes.
A griefer who passes a truthful but **wrong recipient/amount pairing**
(taking another claim's amount) can underpay one user and exhaust
escrow before the rest are paid. There is no on-chain check tying
`amount` to `pendingClaimHandle[recipient]`.

**Test coverage**: see `test/ZamaDropCampaign.test.ts`
"MVP 假设下，非 recipient 也可调用 executeTransfer" (line 366).

### 3.3 Admin and Auditor share a wallet in the demo deployment

**What this means**: In the current `deployments/sepolia.json`, the
`admin` and `auditor` slots resolve to the same wallet address. The
same key that sets allocations also re-encrypts `claimedTotal`.

**Why this is acceptable in v0.x**: The demo runs end-to-end with a
single signer to keep the walkthrough video short and to avoid
distributing testnet ETH to multiple wallets. Privacy guarantees for
**individual** allocations are unaffected — `_allocation[recipient]`
is only authorized for `recipient` via `FHE.allow`, never for the
admin or auditor.

**Failure mode**: Auditor independence is only as strong as the
operator's key separation. If admin and auditor are the same legal
entity, the auditor's "campaign aggregate" attestation provides no
independent assurance.

**Test coverage**: Contract tests use distinct `admin` and `auditor`
signers (`test/ZamaDropCampaign.test.ts` line 34), so the access
control logic itself is exercised. The shared-wallet condition is a
deployment-time choice, not a contract-level claim.

### 3.4 Off-chain Executor is trusted to call back promptly

**What this means**: The path `finalize → Gateway publicDecrypt →
callbackFinalize` and the path `claim → Gateway publicDecrypt →
executeTransfer` both depend on an off-chain process noticing the
emitted handle, decrypting it, and submitting the follow-up
transaction. In the current demo this process is the deployer's
manual script (`scripts/e2e-sepolia.ts`).

**Why this is acceptable in v0.x**: The handles are stored on-chain
and remain valid indefinitely; if the executor is delayed, the
campaign simply waits. No funds are at risk while a claim sits in
the `claimed && !transferred` state.

**Failure mode**: An offline or censored executor causes
indefinite stalls. Recipients have no on-chain remedy in v0.x to
self-execute their own transfer because `executeTransfer` requires
the decrypted amount, which only the Gateway can produce.

## 4. v1 Hardening Roadmap

Listed in priority order. Each item is scoped to a contract change
plus the corresponding deployment or off-chain change.

### 4.1 Authenticate Gateway callbacks

- Restrict `callbackFinalize` to a verified Zama Gateway / KMS
  signature over `(finalizeCheckHandle, result)`. Reject calls whose
  signature does not match the expected KMS public key.
- Migration: add a `kmsVerifier` immutable address (or use the
  fhEVM-provided verifier library), and require the caller to submit
  the signature alongside `result`.

### 4.2 Introduce an explicit Executor role

- Add an `executor` storage slot, initialized in the constructor or
  set once by `admin`.
- `executeTransfer` requires `msg.sender == executor`. The executor
  is expected to be a keeper service (Gelato, OpenZeppelin Defender,
  or an in-house signer) that decrypts `pendingClaimHandle[user]` via
  the Gateway and submits the transfer.
- Optional follow-up: tie `amount` to the ciphertext by also passing
  the Gateway signature over the publicly-decrypted value, so the
  contract can reject mismatched `(recipient, amount)` pairs.

### 4.3 Separate admin and auditor wallets

- Update `deploy/01_deploy.ts` to accept `ADMIN_ADDRESS` and
  `AUDITOR_ADDRESS` as distinct environment variables, and refuse
  to deploy when they collide unless `--allow-shared-roles` is set.
- Update `deployments/sepolia.json` schema to record both wallets and
  their key custodians.

### 4.4 Optional Merkle eligibility layer

- Restore a standard "who can claim" guard by requiring a Merkle
  proof of inclusion in `setAllocation` or `claim`. ZamaDrop's
  "how much" privacy is preserved because the Merkle leaf binds
  only the recipient address, not the amount.
- This decouples eligibility (public list) from allocation
  (encrypted), which is the desired property for most airdrops.

### 4.5 Auditor multisig

- For multi-stakeholder campaigns, allow `auditor` to be a Gnosis
  Safe (2-of-N) rather than an EOA. The contract change is minimal
  (`auditor` is already an `address`), but the off-chain
  re-encryption flow needs to support Safe signing, which is not yet
  exercised by the relayer SDK in v0.x.

## 5. Out of Scope

The following are explicitly **not** addressed by ZamaDrop and are
not on the v1 roadmap:

- Anti-Sybil identification or KYC integration.
- Vesting schedules, cliff periods, or linear unlock curves.
- Confidential ERC-7984 token type (tracked separately as a stretch
  goal; would replace the OpenZeppelin ERC20 escrow with a
  natively-encrypted token).
- Cross-chain bridging of confidential allocations.
- Sanctioned-address screening at the protocol layer; operators are
  expected to apply their own jurisdictional controls upstream of
  `setAllocation`.

## 6. Disclosure Practice

If you discover a deviation from the assumptions captured in
section 3, or a vulnerability that is not covered by the v1
roadmap in section 4, please open a GitHub issue at
`https://github.com/<org>/zamaDrop/issues` (placeholder — replace
with the canonical repository URL on first public release) or
email the maintainers at `security@<domain>` (placeholder).
Coordinated disclosure is appreciated for any issue that affects
real value on a non-demo deployment.
