## Context

The 5-step wizard (`frontend/src/pages/wizard/`) treats in-memory React state and
a deliberately-stripped localStorage snapshot as its progress record. Three
concrete coupling failures cause the "no resume" symptom:

1. `state.ts:178-192` — `partialize` whitelist explicitly **excludes**
   `campaignAddress`, `allocatedSoFar`, `deployStep`, `status`. The author
   notes "once a refresh happens mid-deploy, the in-flight tx state is no
   longer trustworthy — better to restart Step 5 than resume against a stale
   txhash". The decision conflates "stale tx hash is unsafe" (true) with
   "everything about progress is unsafe" (false: chain state is durable
   truth).
2. `Step5Deploy.tsx:156` — `startedRef = useRef(hasExistingExecutionState)`.
   On any remount where the in-memory store still says progress exists, the
   ref initializes to `true` and the deploy effect's `if (startedRef.current)
   return` kicks in immediately. The previous async IIFE has already died
   along with the unmounted component, so nothing is running, but nothing
   restarts either. Component is locked.
3. `Step5Deploy.tsx:120-121` — `errorMsg`, `phase`, `txHash`, `phaseStartedAt`
   are component state. They vanish on every unmount, so the Retry button
   (`{errorMsg && <Alert>...</Alert>}`) disappears the moment the user
   navigates away.

Existing spec `admin-deployment-flow` already requires "from-checkpoint
resume" behavior (§"部署中断续行"), but the implementation contradicts the
spec on persistence. This change aligns implementation with intent and
strengthens the spec to make chain-as-truth explicit.

## Goals / Non-Goals

**Goals:**
- Wizard mount/remount always re-derives current sub-step from chain reads,
  not in-memory progress.
- `campaignAddress` survives every interruption mode short of the user
  manually clearing localStorage: tab switch, page refresh, browser restart,
  MetaMask popup rejection, RPC blip mid-step.
- The Retry / Resume affordance is reachable whenever the chain shows the
  campaign is mid-flow, regardless of which React component just mounted.
- Silent on-chain reverts in 5.1/5.2/5.3/5.4 are detected (status check)
  rather than ignored.
- When chain state is Failed, wizard exposes `cancelCampaign` directly so
  escrow recovery is reachable from the same UI surface that started the
  deploy.

**Non-Goals:**
- Cross-device resume. localStorage is the persistence floor; backend
  registry-based recovery is a separate concern (and is gated by a backend
  registry that today only stores name/admin metadata, not encrypted draft
  state).
- Persisting in-flight transaction hashes for resume. Tx hashes are
  intentionally treated as ephemeral; chain receipt is checked at submission
  time only. Resume re-derives state from `state()` / `balanceOf` /
  `allocationCount` / `allocationSet[r]`.
- The `v8-finalize-recovery` timeout escape hatch (separate active change).
  This change wires the UI hook for Failed-state recovery; V8 will add the
  TimedOut path when it lands.
- Contract changes. `ZamaDropCampaign.sol` is unchanged.
- Trust-model changes. Privacy boundary, FHE handles, ACL grants, and KMS
  callback verification are all untouched.

## Decisions

### Decision 1: Chain state is the only authoritative progress record

We add a pure function `deriveStep(chainState, recipients) → DeploySubStep`
that maps `(state, balance, allocationCount, recipientCount, per-recipient
allocationSet[r])` to the resume sub-step:

| chain state | balance vs declared | allocCount vs N | derived step |
|---|---|---|---|
| Setup | `<` declared | any | 5.2 (fund) |
| Setup | `>=` declared | `<` N | 5.3 (alloc) |
| Setup | `>=` declared | `==` N | 5.4 (finalize) |
| Finalizing | any | any | 5.5 (KMS callback) |
| Claiming | any | any | done |
| Failed | any | any | recovery (cancelCampaign) |

`deriveStep` lives in a new file `frontend/src/pages/wizard/derive-step.ts`
as a stateless helper, fully testable without React.

For 5.3, when `allocationCount < recipientCount`, we need to know **which**
recipients are still pending. Two options considered:

- **(A) Per-recipient `allocationSet[r]` reads** — N RPC calls. Simple,
  matches existing `setOneAllocation` semantics.
- **(B) `AllocationSet` event log scan** — one `getLogs` call from the
  campaign deploy block. Cheaper for large N, but requires either knowing
  the deploy block (we don't persist it) or scanning a wide window.

**Decision: (A) with multicall batching.** Use viem's `Multicall3` (deployed
on Sepolia at the canonical address) to batch the N reads into one RPC
roundtrip. Avoids the deploy-block bookkeeping problem and keeps deriveStep
pure. For N ≤ 500 (current cap), one multicall is sufficient.

Rejected: (B) because event scanning needs `fromBlock` and we don't want
to either widen the partialize whitelist for one extra field or scan the
full chain. (A) is simpler and correctness is obvious.

### Decision 2: Persist `campaignAddress` immediately after 5.1 succeeds

`partialize` whitelist gains `campaignAddress`. Persistence happens on the
`setCampaignAddress` action, which is called inside `executeDeployment`
right after `deployContract` returns the receipt. This is the minimum
durability we need: 5.1 is the only step that mints a non-recoverable
piece of identity (the contract address). Everything else can be
re-derived from `(campaignAddress, recipients, snapshot)`.

We do **not** persist `allocatedSoFar` or `deployStep`. They are now
redundant — `deriveStep` reads chain. Keeping them would create two
sources of truth that drift on the very interruption modes this change
exists to fix.

`status` (`draft | deploying | deployed | failed_partial`) is persisted.
It is used as a UI hint (show Resume banner, show Retry button) but is
**advisory** — chain state is the tiebreaker if they disagree.

### Decision 3: Schema migration via version bump + drop

zustand `PERSIST_SCHEMA_VERSION` goes 1 → 2. The `partialize` whitelist
expands but no field changes meaning. Old `v1` localStorage entries are
dropped (zustand's default `migrate` returns initial state when version
is older).

Rationale: drafts are user input, not durable state. A user who had a
half-filled wizard before this change can re-enter it; we trade ten
minutes of data re-entry for zero migration risk. Writing a real
migration would require us to read v1 fields and reconstruct
`campaignAddress` from chain — but if v1 didn't persist `campaignAddress`,
it isn't recoverable from localStorage at all. So a migration cannot
materially help anyone.

Considered: silent merge migration. Rejected: false sense of recovery.
The drop forces explicit re-entry, which is honest about what we lost.

### Decision 4: Replace `startedRef` with a deploy-effect re-entry guard

The current `startedRef = useRef(hasExistingExecutionState)` is wrong on
two counts: (a) it persists "started-ness" across remounts even after the
prior async work died with the component, and (b) it conflates "I have
in-flight work" with "the IIFE is currently running".

Replacement: drop the init-from-existing-state. `startedRef` always
starts `false` on mount. The effect body's first action is to read chain
state and call `deriveStep`. If the result is `done`, the effect exits
without re-deploying; otherwise it enters `executeDeployment` with
`resumeFromStep` set to the derived step.

This means a remount with non-trivial in-store progress will *automatically*
re-enter the deploy flow at the right step. No Retry button click needed
unless the user explicitly opted to pause (a separate UX state, not
covered here).

The existing StrictMode double-invoke concern is handled by the standard
ref+cleanup pattern: if the cleanup fires before the await chain settles,
set a flag the IIFE checks before each `setState`.

### Decision 5: Errors are derived from store, not held in component state

Three component-state errors today: `errorMsg`, `errorRecovery`,
`registrationWarning`. They die on unmount and the Retry button with them.

New rule: any error message that should survive remount goes to the store
under a single field `lastDeployError: { message: string; recovery?: string;
kind: 'kms-timeout' | 'kms-failed' | 'user-rejected' | 'chain-error' |
'register-failed' } | null`. Persisted via `partialize`. Cleared on
successful step advance and on explicit Retry click.

`registrationWarning` stays component-state (it's about a backend POST
that can be re-attempted with one button click; nothing chain-side
depends on it).

### Decision 6: `executeDeployment` accepts `resumeFromStep`

Signature change:

```ts
async function executeDeployment(
  ctx: DeployContext,
  resumeFromStep: DeploySubStep = 1,  // default = full flow
): Promise<Address>
```

Inside, each sub-step block becomes:

```ts
if (resumeFromStep <= 1) {
  // run 5.1
} else {
  // 5.1 already done — campaignAddress comes from ctx.existingCampaignAddress
}
```

The existing idempotency guards (5.2 balance check, 5.3 alreadyAllocated,
5.4 state check, 5.5 state check) stay in place as belt-and-suspenders
defense. `resumeFromStep` is the fast path; the guards are correctness.

### Decision 7: Receipt-status check at five sites

`viem.waitForTransactionReceipt` returns `receipt.status: 'success' |
'reverted'` and does **not** throw on revert. Today `deploy.ts` ignores
this in five places (lines 251, 298, 387, 442, 480). Add a thin helper:

```ts
async function awaitOrThrow(client, hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new TxRevertedError(`Tx ${hash} reverted on-chain`, hash);
  }
  return receipt;
}
```

Replace the five `await waitForTransactionReceipt({hash})` calls with
`awaitOrThrow(client, hash)`. New `TxRevertedError` class so `executeDeployment`
catch can route it into `lastDeployError` with kind `chain-error`.

This catch-all means a future "wizard thinks it's done but on-chain
state disagrees" mismatch becomes a hard error instead of a silent skip
into finalize.

## Risks / Trade-offs

- **[Risk] localStorage clear loses `campaignAddress` permanently** →
  Mitigation: Step 5 success screen already prints the campaign URL.
  Admins should bookmark or share the URL. Backend registry persistence
  (out-of-scope here) is the proper long-term fix.
- **[Risk] Multicall RPC failure on resume read** → Mitigation: fall back
  to per-recipient reads on multicall failure. If both fail, surface a
  "RPC unavailable, cannot resume — try again" message and don't show
  Resume banner with stale data.
- **[Risk] User has a campaign in-flight in tab A, opens wizard in tab B**
  → Both read chain, both see same state, both try to advance. The
  contract's idempotency guards win (5.2 balance check, 5.3
  AllocationAlreadySet revert, 5.4 NotSetup revert), but UX shows two
  competing flows. Acceptable for MVP — multi-tab admin workflow is
  not a target. Document in known-limitations.
- **[Risk] Silently swallowed prior reverts surface as new errors after
  upgrade** → A user whose previous deploy "looked fine" but actually
  had a reverted setAllocation will now see an error. This is the
  desired behavior; the funds are not at risk and the contract's
  invariants caught the underlying problem. We add a one-line note to
  the upgrade changelog.
- **[Risk] `deriveStep` returns wrong step due to RPC race (e.g., reads
  a finalize tx that's in the mempool but not mined)** → Mitigation:
  `state()` is a storage read, only reflects mined state. Mempool tx
  doesn't pollute the read. Verified.
- **[Trade-off] Removing `startedRef` init-from-store means StrictMode
  double-mount triggers two `executeDeployment` calls in dev mode** →
  Mitigation: add a per-mount lock (`useRef<Promise|null>`) that
  serializes effect bodies. Production unaffected (no double-mount).

## Migration Plan

1. Land `state.ts` schema bump (v1 → v2) + `partialize` widening +
   add `lastDeployError` field. localStorage `zd:wizard-draft-v1`
   entries silently dropped on first load. No user-facing migration UI.
2. Land `derive-step.ts` + multicall helper + tests (pure unit tests
   on `deriveStep`).
3. Land `deploy.ts` changes: `awaitOrThrow` wrapper, `resumeFromStep`
   parameter, `TxRevertedError` class.
4. Land `Step5Deploy.tsx` rewrite: drop `startedRef` init-from-store,
   add chain-read-on-mount + Resume banner, replace component-state
   errors with store-derived view, expose Failed-state cancelCampaign
   panel.
5. Manual e2e on Sepolia: deploy a fresh campaign, kill tab during
   each sub-step, reopen, verify resume picks up correctly. Test
   includes a forced popup rejection at 5.4 (the original failure
   mode that triggered this change).

Rollback: revert all 5 PRs. Schema downgrade not needed — old code
ignores the new persisted fields.

## Open Questions

- Should `recipients` (not just addresses, also the encrypted-input
  payload) be persisted, in case a user reopens the wizard after the
  draft-encryption KEK rotates? Current `partialize` already persists
  `recipients`, so this is a no-op for this change but worth noting
  as a coupling between this change and `draft-encryption`.
- Should the Resume banner warn when chain state diverges from
  store-cached `status` (e.g., store says `failed_partial` but chain
  is already Claiming)? Lean yes — but this is UX polish, not
  correctness.
