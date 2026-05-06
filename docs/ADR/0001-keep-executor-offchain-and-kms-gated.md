# ADR 0001: Keep Executor Offchain And KMS-Gated

## Status

Accepted

## Context

ZamaDrop settlement has two asynchronous paths:

- `finalize()` emits a publicly decryptable handle for the encrypted total equality check.
- `claim()` emits a publicly decryptable handle for the recipient amount.

An offchain process must relay Gateway/KMS decryptions back onchain. Earlier MVP versions treated the callback caller and plaintext arguments as trusted, which allowed forged finalize results or forged transfer amounts.

## Decision

Keep the executor as an offchain liveness component only. The executor may be run by the operator, recipient, admin, auditor, or any third party.

Contract integrity MUST be enforced by `FHE.checkSignatures`:

- `callbackFinalize(result, proof)` verifies the KMS threshold signature for `finalizeCheckHandle`.
- `executeTransfer(recipient, amount, proof)` verifies the KMS threshold signature for `pendingClaimHandle[recipient]`.

The caller identity is not the trust root; the KMS proof is.

## Consequences

- A malicious executor cannot forge finalize bools or transfer amounts.
- An offline executor can still delay settlement, so liveness can be improved by running multiple executors.
- Frontend and scripts must pass the Gateway `decryptionProof` through to the contract.
- Security docs must describe executor compromise as a liveness risk, not an integrity risk.

## References

- [AGENTS.md](../../AGENTS.md)
- [SECURITY.md](../SECURITY.md)
- [ZamaDropCampaign.sol](../../contracts/ZamaDropCampaign.sol)

