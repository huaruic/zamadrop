# campaign-contract (delta) — V8 finalize-recovery

## ADDED Requirements

### Requirement: TimedOut state distinct from Failed

The contract SHALL expose a fifth state `TimedOut` in `enum State`, used
exclusively for the path "admin force-cancelled a stuck Finalizing
campaign because KMS callback never arrived". `Failed` SHALL retain its
narrow semantic of "KMS proved sum mismatch via callbackFinalize(false)".

#### Scenario: TimedOut emitted only by adminTimeoutCancel

- **WHEN** a campaign in state `Finalizing` is force-cancelled by admin
  via `adminTimeoutCancel()`
- **THEN** state SHALL transition to `TimedOut`
- **AND** event `FinalizeTimedOut(finalizeRequestedAt, block.timestamp)`
  SHALL be emitted
- **AND** funds SHALL remain escrowed in the contract until
  `cancelCampaign()` is called

#### Scenario: Failed state never reached via timeout path

- **WHEN** state is `Finalizing` and admin calls `adminTimeoutCancel()`
- **THEN** state SHALL NOT transition directly to `Failed`
- **AND** any auditor / indexer / frontend observing the chain SHALL be
  able to distinguish "campaign reached Failed via KMS sum mismatch"
  from "campaign reached Failed because admin gave up after timeout"

### Requirement: adminTimeoutCancel admin escape hatch

The contract SHALL provide an `adminTimeoutCancel()` function callable
only by `admin`, only when state is `Finalizing`, only after at least
`finalizeEscapeTimeout` seconds have elapsed since `finalizeRequestedAt`.

#### Scenario: Successful admin timeout cancel

- **WHEN** admin calls `adminTimeoutCancel()`
- **AND** state is `Finalizing`
- **AND** `block.timestamp >= finalizeRequestedAt + finalizeEscapeTimeout`
- **THEN** state SHALL transition to `TimedOut`
- **AND** the call SHALL emit `FinalizeTimedOut(finalizeRequestedAt, block.timestamp)`

#### Scenario: Non-admin call reverts

- **WHEN** any address other than `admin` calls `adminTimeoutCancel()`
- **THEN** the call SHALL revert with `NotAdmin()`

#### Scenario: Wrong state reverts

- **WHEN** `adminTimeoutCancel()` is called while state is anything other
  than `Finalizing`
- **THEN** the call SHALL revert with `NotFinalizing()`

#### Scenario: Premature timeout reverts

- **WHEN** admin calls `adminTimeoutCancel()` while
  `block.timestamp < finalizeRequestedAt + finalizeEscapeTimeout`
- **THEN** the call SHALL revert with `EscapeTimeoutNotReached()`

### Requirement: Late KMS callback recovers TimedOut campaigns

The contract SHALL allow `callbackFinalize(true, decryptionProof)` to
transition state from `TimedOut` to `Claiming`, preserving recipient
claim rights when KMS finally responds.

#### Scenario: KMS arrives during TimedOut window

- **WHEN** state is `TimedOut`
- **AND** `callbackFinalize(true, validProof)` is called
- **AND** `FHE.checkSignatures` accepts the proof
- **THEN** state SHALL transition to `Claiming`
- **AND** recipients SHALL be able to call `claim()` normally

#### Scenario: KMS reports mismatch during TimedOut window

- **WHEN** state is `TimedOut`
- **AND** `callbackFinalize(false, validProof)` is called
- **THEN** state SHALL transition to `Failed`

### Requirement: cancelCampaign accepts TimedOut as terminal cutoff

The contract SHALL allow `cancelCampaign()` to be called when state is
`Failed` OR `TimedOut`. From `TimedOut`, it SHALL transition state to
`Failed` BEFORE transferring funds, making the cancellation irreversible.

#### Scenario: Cancel from TimedOut transfers and locks state

- **WHEN** admin calls `cancelCampaign()` while state is `TimedOut`
- **THEN** state SHALL transition to `Failed`
- **AND** the contract's full token balance SHALL be transferred to
  admin via `safeTransfer`
- **AND** event `CampaignCancelled(returnedAmount)` SHALL be emitted

#### Scenario: Late KMS callback after cancel reverts

- **WHEN** state is `Failed` (transitioned from TimedOut via
  cancelCampaign)
- **AND** `callbackFinalize(true, validProof)` is called subsequently
- **THEN** the call SHALL revert with `NotFinalizing()`

### Requirement: finalizeEscapeTimeout is a constructor parameter

The contract SHALL accept an `escapeTimeout_` parameter in its constructor
(7th argument). When `escapeTimeout_ == 0`, the contract SHALL store
`finalizeEscapeTimeout = 1 hours`. Otherwise it SHALL store the provided
value verbatim.

#### Scenario: Default applied for zero argument

- **WHEN** the contract is deployed with `escapeTimeout_ = 0`
- **THEN** `finalizeEscapeTimeout()` SHALL return `3600` (1 hour in seconds)

#### Scenario: Custom timeout honored

- **WHEN** the contract is deployed with `escapeTimeout_ = 86400`
- **THEN** `finalizeEscapeTimeout()` SHALL return `86400`
- **AND** `adminTimeoutCancel()` SHALL revert until 24 hours have
  passed since `finalize()`

### Requirement: finalizeRequestedAt timestamp is recorded once

The contract SHALL set `finalizeRequestedAt = block.timestamp` exactly
once during `finalize()`, atomically with the state transition to
`Finalizing`.

#### Scenario: Set on finalize

- **WHEN** `finalize()` succeeds
- **THEN** `finalizeRequestedAt()` SHALL return the block timestamp of
  that transaction
- **AND** subsequent reads SHALL return the same value

## MODIFIED Requirements

### Requirement: callbackFinalize state guard

(V7 spec: only Finalizing.)

The contract SHALL accept `callbackFinalize(result, decryptionProof)`
when state is `Finalizing` OR `TimedOut`. All other states SHALL revert
with `NotFinalizing()`.

#### Scenario: Replay from Claiming reverts

- **WHEN** state is `Claiming` and `callbackFinalize` is called again
- **THEN** the call SHALL revert with `NotFinalizing()`

#### Scenario: Replay from Failed reverts

- **WHEN** state is `Failed` and `callbackFinalize` is called again
- **THEN** the call SHALL revert with `NotFinalizing()`

### Requirement: cancelCampaign state guard

(V7 spec: only Failed.)

The contract SHALL accept `cancelCampaign()` when state is `Failed` OR
`TimedOut`. Other states SHALL revert with `NotFailed()`.

When invoked from `TimedOut`, the function SHALL transition state to
`Failed` before performing any token transfer.
