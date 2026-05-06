# ZamaDrop Frontend

The dApp surface for [ZamaDrop](../README.md) — the project root README is the
canonical entry point. This file covers only the frontend-specific quick start
and structure.

## Stack

- Vite + React + TypeScript
- React Router 7 (`/`, `/campaign/:address`, plus `admin` / `me` / `audit`
  sub-routes)
- wagmi + viem for wallet & contract reads/writes; `@zama-fhe/relayer-sdk` for
  FHE encryption / user re-encryption / public decryption
- Tailwind v4 + shadcn UI primitives (`src/components/ui/*`)
- Design tokens shared with the [`secret-drop`](https://github.com/ernestchen247/secret-drop)
  landing repo via `src/styles/{tokens,effects}.css`

## Quick start

```bash
bun install
bun run dev          # http://localhost:5173
bun run build
bun run preview
```

Environment overrides (optional — falls back to `deployments/sepolia.json`):

```
cp .env.example .env
# then edit:
#   VITE_CAMPAIGN_ADDRESS=0x...
#   VITE_TOKEN_ADDRESS=0x...
```

## Source layout

```
src/
├── main.tsx              # bootstrap + WagmiProvider + RouterProvider
├── App.tsx               # router definition
├── wagmi.ts              # Sepolia config
├── fhevm.ts              # encryptUint64 / userDecryptEuint64 / publicDecrypt
├── abis.ts               # CAMPAIGN_ABI + ERC20_ABI (trimmed)
├── config.ts             # contract addresses (env-overridable)
├── useRoleInfo.ts        # single source of truth for role membership
├── pages/
│   ├── PublicHome.tsx
│   ├── CampaignLayout.tsx     # V6 capability tabs + CapabilityStrip header
│   ├── CampaignOverview.tsx
│   ├── admin/                 # AdminPage + SetAllocationForm + AllocationLedger + FinalizePanel
│   ├── recipient/             # RecipientPage + AllocationCard + ClaimStepper + BalancePanel
│   └── auditor/               # AuditorPage + AggregateCard + ComplianceCard + ClaimsActivity
├── components/
│   ├── CampaignCard.tsx       # 3-state phase badge (Setup / Finalize-pending / Claiming)
│   ├── CapabilityStrip.tsx    # Overview chip strip
│   ├── TopBar.tsx
│   ├── PageLayout.tsx
│   └── ui/                    # shadcn primitives
├── hooks/
│   ├── useCampaignReads.ts    # multicall: admin/auditor/declaredTotal/...
│   ├── useTokenMeta.ts        # symbol/decimals + format / parseTokenAmount
│   ├── useCampaignEvents.ts   # 3 hooks: Allocation / Claimed / Transferred
│   ├── useUserDecryptEuint64.ts
│   └── useCampaignParam.ts    # typed Outlet context
└── styles/
    ├── tokens.css
    └── effects.css
```

## Role / capability protocol

The four-tab IA (`Overview` / `Admin` / `Recipient` / `Auditor`) follows the
**V6 capability-tab** design — all tabs always visible, role-gated tabs render
`· active` / `· preview` suffixes, and `CapabilityStrip` on Overview advertises
which roles the connected wallet holds. Full protocol spec:
[`../docs/role-page-protocol.md`](../docs/role-page-protocol.md).

## Trust posture

The frontend never triggers `callbackFinalize` or `executeTransfer`. Settlement
runs off-chain via [`scripts/executor.ts`](../scripts/executor.ts), and the
contract verifies KMS threshold signatures before mutating state. See
[`../docs/SECURITY.md`](../docs/SECURITY.md).

## Vite specifics

- HMR overlay is intentionally disabled in `vite.config.ts` for a calmer dev
  experience.
- `resolve.dedupe` forces single copies of `react`, `react-dom`, the JSX
  runtimes, and `@tanstack/react-query`. Add to that list rather than removing
  it if you pull in something that drags a duplicate React.

## Tests

End-to-end tests (Synpress + Playwright) live in the project root and are
documented at [`../test/TEST_PLAN.md`](../test/TEST_PLAN.md).
The `e2e/` directory under `frontend/` from earlier MVP iterations was deleted
during the V6 rebuild — there is no per-frontend test runner yet.
