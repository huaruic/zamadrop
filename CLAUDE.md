# ZamaDrop — CLAUDE.md

Project-level instructions for Claude Code agents. The canonical
agent-agnostic spec lives in [`AGENTS.md`](./AGENTS.md); this file only
adds Claude-Code-specific guidance.

## Project at a Glance

ZamaDrop is a confidential token distribution protocol on Zama fhEVM.
FHE encrypts every recipient allocation; the on-chain sum check
enforces the campaign total in ciphertext, so the campaign is publicly
verifiable while individual amounts remain private.

For full product context see [`README.md`](./README.md) and
[`docs/product/prd.en.md`](./docs/product/prd.en.md).

## Tech Stack

- **Contracts**: Solidity ^0.8.24, `@fhevm/solidity` ^0.11.1
- **Toolchain**: Hardhat ^2.28.4, TypeScript
- **FHE testing**: `@fhevm/mock-utils` ^0.4.2, `@fhevm/hardhat-plugin` ^0.4.2
- **Frontend**: Vite + React 19, wagmi v3, `@zama-fhe/relayer-sdk` ^0.4.2, shadcn/ui
- **Node.js**: ≥ 20 (frontend also supports bun)

## FHE API — must use `FHE.xxx`, not legacy `TFHE.xxx`

```solidity
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

euint64 val = FHE.fromExternal(encInput, proof);
euint64 sum = FHE.add(a, b);
ebool   eq  = FHE.eq(a, b);

FHE.allowThis(handle);          // contract reads
FHE.allow(handle, addr);        // grant addr decrypt rights
FHE.allowForDecryption(handle); // allow Gateway public decrypt
```

## Core Contract

`contracts/ZamaDropCampaign.sol`

- Roles: `Admin` / `Recipient` / `Auditor` / `Public` + off-chain
  `Executor` (system) — see [`docs/role-page-protocol.md`](./docs/role-page-protocol.md)
- State machine: `Setup → Finalized → Claiming`
- Trust assumptions: see [`docs/SECURITY.md`](./docs/SECURITY.md)

## Verification Commands

```bash
npm run compile        # compile contracts
npm test               # Hardhat tests with fhEVM mock
npm run coverage       # coverage report
npm run lint           # lint TS + Solidity

# Frontend (supports npm or bun)
cd frontend && npm install   # or: bun install
npm run dev            # Vite dev server on 5173
npm run build          # tsc -b + vite build
npm run lint
```

## Key Invariants (read before changing the contract)

1. **Allocations are append-only** — `setAllocation` must revert when
   called twice on the same recipient
2. **`claim()` is atomic** — set `claimed[addr] = true` *before* the
   FHE add and the transfer, so a revert anywhere unwinds the whole
   call (no double claim)
3. **`claimedTotal` only updates inside `claim()`** — never anywhere else
4. **Gateway callback latency** — testnet finalize callback takes 1–3
   blocks; demos should finalize ahead of time
5. **Gas budget** — `claim()` does two FHE ops; if it crosses ~3M gas,
   split it

## Out of Scope (MVP)

- Merkle proof eligibility verification
- Vesting unlock curves
- Multi-campaign factory
- ERC-7984 confidential token type (stretch goal)
- Hiding the public "has-claimed" boolean
- CSV bulk import

## Scratch Output Policy

Do not create agent-specific planning folders under `docs/`, including `docs/superpowers/` (now .gitignore'd). If a planning or brainstorming tool wants to write there, redirect durable content into `openspec/changes/<change-id>/` as proposal/design/tasks/specs. Keep disposable notes in `.private/` only. See AGENTS.md "文档落点规则" for the canonical mapping.
