# ZamaDrop - Project Instructions

ZamaDrop is a confidential token distribution protocol built on Zama's fhEVM using Fully Homomorphic Encryption (FHE). It ensures "campaign-level transparency, personal-level privacy" by allowing public verification of total distribution amounts while keeping individual allocations private.

## Tech Stack
- **Smart Contracts**: Solidity ^0.8.24, `@fhevm/solidity` ^0.11.1
- **Toolchain**: Hardhat ^2.28.4, TypeScript
- **Frontend**: Vite + React 19, Wagmi v3, Viem, `@zama-fhe/relayer-sdk` ^0.4.2
- **Testing**: Hardhat (mock fhEVM), Playwright + Synpress (E2E with MetaMask)
- **Environment**: Node.js >= 20

## Key Commands

### Root (Contract Development)
- `npm install`: Install dependencies
- `npm run compile`: Compile smart contracts
- `npm test`: Run Hardhat tests (using fhEVM mock)
- `npm run coverage`: Generate test coverage report
- `npm run lint`: Run ESLint for TS and Solidity files

### Frontend
- `cd frontend && npm install`: Install frontend dependencies
- `npm run dev`: Start Vite development server
- `npm run build`: Build for production
- `npm run e2e`: Run Playwright E2E tests
- `npm run e2e:wallet-regression`: Run E2E tests involving MetaMask

## Development Conventions

### FHE API Usage
Always use the modern `FHE.xxx` API from `@fhevm/solidity/lib/FHE.sol`. Do **NOT** use the legacy `TFHE.xxx` API.
- `FHE.add(a, b)`: Add two encrypted values
- `FHE.eq(a, b)`: Compare two encrypted values (returns `ebool`)
- `FHE.allow(handle, address)`: Grant access to an encrypted value
- `FHE.allowThis(handle)`: Grant the contract itself access
- `FHE.fromExternal(input, proof)`: Import encrypted input from client

### Smart Contract Architecture
- **State Machine**: `Setup` → `Finalized` → `Claiming`.
- **Atomic Claims**: Ensure `claimed[addr] = true` is set before FHE operations and transfers to prevent double-spending.
- **Gateway Callbacks**: Finalization relies on a Gateway callback. In testing, this might be simulated or require manual triggers.

### Frontend Patterns
- Use `data-testid` attributes for stable E2E testing selectors.
- Roles are categorized as: `Public`, `Admin`, `Recipient`, `Auditor`.
- Use `@zama-fhe/relayer-sdk` for EIP-712 signatures required for re-encryption/decryption.

## Project Structure
- `contracts/`: Solidity source files. `ZamaDropCampaign.sol` is the core contract.
- `frontend/`: Vite-based React application.
- `test/`: Hardhat unit and integration tests.
- `docs/`: Product Requirement Document (PRD), test plans, and architectural strategies.
- `openspec/`: Change logs and task definitions following a spec-driven workflow.
- `deploy/` & `deployments/`: Hardhat-deploy scripts and network-specific deployment data.

## Deployment Information (Sepolia)

Live contract addresses (MockToken, ZamaDropCampaign) and metadata are
maintained in `deployments/sepolia.json`. The `frontend/src/config.ts`
file imports those addresses for the UI; do not hard-code deployer or
auditor wallet addresses anywhere in source.

## Trust Assumptions

See [`docs/SECURITY.md`](./docs/SECURITY.md). `callbackFinalize` and
`executeTransfer` are permissionless callers but verify Zama KMS threshold
signatures via `FHE.checkSignatures` before mutating state. Trust root is
the KMS signature, not the caller.
