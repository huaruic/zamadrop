# ZamaDrop — Verification Ladder

A 4-layer verification stack for the V7 dApp. Each layer is cheaper to run
than the next, but covers a narrower failure surface. Demo-readiness requires
all four to pass.

| Layer | Tool | What it proves | Cost |
|---|---|---|---|
| 1. Static | `tsc` + `vitest` + `lint` | code compiles, unit tests green, no lint regressions | seconds |
| 2. DOM smoke | `npm run dev` + manual click-through | nothing whitepages on the happy path | minutes |
| 3. UI mock | `stateNum` patch + browser inspect | rare-state UI branches render correctly | ~15 min |
| 4. E2E real chain | `verify-failed-recovery.ts` + manual MetaMask | UI button → contract tx → state change actually works | ~20 min |

---

## Layer 1 — Static

```bash
cd frontend
npx tsc --noEmit -p tsconfig.app.json
npx vitest run
npm run lint
```

Pass criteria: `tsc` exits 0, `vitest` all green, `lint` introduces no new
errors (pre-existing `badge.tsx` / `button.tsx` / `fhevm.ts` /
`SetAllocationForm.tsx` errors are baseline).

## Layer 2 — DOM smoke

```bash
cd frontend && npm run dev
# Visit http://localhost:5173/c/<existing-Sepolia-campaign>?role=admin
# Switch ?role=recipient and ?role=auditor — confirm no whitescreen
```

Pass criteria: all three role pages render, existing badges / forms / data
still appear. Catches accidental render regressions on the common path.

## Layer 3 — UI mock for rare-state branches

Some UI branches (e.g. `State.Failed`) cannot be reached via the wizard's
own happy path because Step 4 enforces `declaredTotal == sum(amounts)`. Mock
them in the browser instead.

### Approach A — React DevTools

Open the page, find the component (`AdminPage` / `RecipientPage` /
`AuditorPage`), find the `stateNum` hook return, override its value to `3`.
Inspect the resulting render.

### Approach B — temporary code patch

In each of `AdminPage.tsx`, `RecipientPage.tsx`, `AuditorPage.tsx`, replace
the `stateNum` derivation with a hardcoded `3`:

```ts
// LAYER-3-MOCK: revert before commit
const stateNum: number | undefined = 3;
```

After verifying, revert the patches with `git checkout -- <files>`.

### Failed-state pass criteria

- **Admin** — `CancelCampaignForm` renders with destructive border, shows
  recoverable balance, button reads "Cancel campaign and recover funds".
  Existing `SetAllocationForm` / `FinalizePanel` are hidden.
- **Recipient** — destructive Alert "Campaign in Failed state" with copy
  branch driven by real on-chain `balanceOf(campaign)`.
- **Auditor** — destructive banner "Campaign in Failed state" at the top,
  existing audit cards remain.

Clicking the admin's `Cancel campaign and recover funds` button against a
Sepolia campaign whose real state is **not** Failed will revert at
simulation. The error display should show the human-friendly mapped copy
("Campaign is not in Failed state…"), not the raw viem string. This
indirectly verifies the `parseContractRevert` map.

## Layer 4 — End-to-end real chain

Two flows. Layer 4a is fully automated; Layer 4b needs MetaMask.

### Layer 4a — automated contract-level E2E

```bash
npx hardhat run scripts/verify-failed-recovery.ts
```

Runs entirely in-process on the hardhat network. Deploys a fresh ZDT +
ZamaDropCampaign, drives the wizard's full sub-step sequence with
intentionally wrong allocations to land in `State.Failed`, then exercises
the recovery path via signer calls.

Asserts (11 total):

1. KMS `sumCheck` returns `false` for 300 ≠ 1000
2. State transitions to `Failed (3)` after `callbackFinalize(false)`
3. Campaign holds the full escrow before recovery
4. `recipient2.cancelCampaign()` reverts (non-admin)
5. Revert reason includes `NotAdmin`
6. `CampaignCancelled.returnedAmount == declaredTotal`
7. Campaign balance == 0 after admin's cancelCampaign
8. Admin balance delta == +declaredTotal
9. State remains `Failed` (cancelCampaign does not transition)
10. Second `cancelCampaign` is idempotent (`returnedAmount == 0`)
11. Campaign balance stays 0 after second call

Most recent run output:

```
============================================================
  ✅ LAYER 4 E2E VERIFICATION PASSED
============================================================
Total assertions: 11
Campaign:         0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
Token:            0x5FbDB2315678afecb367f032d93F642f64180aa3
Admin:            0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

Verified invariants:
  • State.Failed reachable via callbackFinalize(false)
  • Non-admin cancelCampaign() reverts with NotAdmin
  • Admin cancelCampaign() transfers full escrow back to admin
  • CampaignCancelled(returnedAmount) emitted with correct value
  • State stays Failed after cancelCampaign (no transition)
  • Second cancelCampaign() is idempotent (returnedAmount=0)
============================================================
```

### Layer 4b — manual UI E2E

Confirms the CancelCampaignForm button → MetaMask signature → tx receipt →
UI state-change loop. Layer 4a substitutes a signer call for the button,
which means the FE-to-wallet hop is the only thing 4b adds.

```bash
# Terminal 1 — persistent hardhat node
npx hardhat node

# Terminal 2 — produce a Failed campaign on the persistent node
npx hardhat run scripts/trigger-failed.ts --network localhost
# Copy the Campaign address and Token address from the output banner

# Terminal 3 — frontend connected to local chain
cd frontend
VITE_RPC_URL=http://127.0.0.1:8545 \
VITE_TOKEN_ADDRESS=<token-from-banner> \
npm run dev
```

MetaMask:

1. Add network: `Localhost 8545`, chainId `31337`, currency `ETH`
2. Import deployer account using hardhat's default mnemonic:
   `test test test test test test test test test test test junk` (slot 0
   is the deployer)

Browser:

3. Open `http://localhost:5173/c/<campaign-address>?role=admin`
4. Verify `CancelCampaignForm` renders with `Recoverable balance: 1000 ZDT`
5. Click `Cancel campaign and recover funds`
6. Sign in MetaMask
7. After tx mines:
   - Card shows `Funds already recovered.`
   - Admin wallet balance increased by 1000 ZDT
8. Switch to `?role=recipient` and refresh:
   - Failed copy switches from "admin has not yet called cancelCampaign…"
     to "Funds have been returned to the admin via cancelCampaign"
9. Switch to `?role=auditor` and refresh:
   - Banner is still present (state still Failed)

## Negative-path UI quick check

Click `Cancel campaign and recover funds` against a Sepolia campaign whose
state is **not** Failed (e.g. an existing Claiming campaign):

Expected: destructive Alert with copy

> Campaign is not in Failed state. cancelCampaign only works after KMS
> reports a sum mismatch. Refresh the page and verify the campaign's
> current state.

NOT the raw viem string `gas limit too high`. This validates the
`parseContractRevert` mapping in `frontend/src/lib/revert-reason.ts`.
