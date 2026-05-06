## 1. Setup

- [ ] 1.1 Create feature branch `feat/v7-dapp-wizard` from latest `main`
- [ ] 1.2 Verify `npm run compile` and `npm test` pass on baseline (no V7 changes yet)

## 2. Contract Refactor (TDD per change, each commit must keep all tests green)

- [x] 2.1 Add custom errors to `contracts/ZamaDropCampaign.sol`: `HashMismatch`, `CountMismatch`, `NotFunded`, `NoExcess`, `ExceedsExcess`
- [x] 2.2 Refactor constructor to accept `(address admin_, address auditor_, address token_, uint64 declaredTotal_, address[] memory recipients, bytes32 listHash_)`; verify `keccak256(abi.encode(recipients)) == listHash_`; store `recipientListHash` immutable; do NOT persist `recipients` array. Write 3 new tests covering: deployer ≠ admin, hash mismatch reverts, recipientListHash readable
- [x] 2.3 Migrate the 26 existing tests in `test/ZamaDropCampaign.test.ts` to a unified `deployCampaign(opts)` helper that builds `recipients` + `listHash` automatically. After migration, full suite must pass
- [x] 2.4 Add `uint64 public allocationCount` state; increment in `setAllocation` after `allocationSet[recipient] = true`. Write 1 new test asserting counter increments per call
- [x] 2.5 In `finalize()`, add `if (allocationCount != recipientCount) revert CountMismatch();` before existing FHE.eq logic. Write 2 new tests: count mismatch reverts; matched count proceeds
- [x] 2.6 In `finalize()`, add `if (token.balanceOf(address(this)) < declaredTotal) revert NotFunded();` after the count check. Write 2 new tests: under-funded reverts; exactly-funded proceeds. Update existing finalize tests to fund escrow first
- [x] 2.7 Replace `import {IERC20}` with paired imports of `IERC20` + `SafeERC20`; add `using SafeERC20 for IERC20;`. Replace `require(token.transfer(user, amount), ...)` in `executeTransfer` with `token.safeTransfer(user, amount)`. Existing tests must still pass (ZDT is standard ERC20)
- [x] 2.8 Add `uint64 public claimedTotalPlaintext` state; accumulate `amount` in `executeTransfer` after `transferred[user] = true`. Write 1 new test: counter accumulates across multiple successful claims
- [x] 2.9 Add `event ExcessWithdrawn(uint256 amount, uint256 remainingBalance)` and `function withdrawExcess(uint256 amount)` per `campaign-contract` spec (Option C). Write 5 new tests: non-admin reverts, no-excess reverts, exceeds-max reverts, successful withdraw during Setup, post-claim maxWithdraw correctness
- [x] 2.9a 引入 `enum State { Setup, Finalizing, Claiming, Failed }` 替换 `bool finalized`。更新 setAllocation / finalize / callbackFinalize / claim / executeTransfer 的状态守卫(每个相关函数加 `if (state != ExpectedState) revert NotAllowedInState();`)。新增 7 个测试覆盖每个状态转换 + 非法转换 revert。

- [x] 2.9b 添加 `cancelCampaign()` 函数:`onlyAdmin`,`require(state == State.Failed)`,`token.safeTransfer(admin, balanceOf(this))`,emit `CampaignCancelled(uint256 returnedAmount)` 事件。新增 4 个测试覆盖:非 admin revert / 非 Failed 状态 revert / Failed 状态成功取回全额 / 重复调用第二次 balance 已为 0 的行为。
- [x] 2.10 Run `npm run coverage`; confirm coverage on `ZamaDropCampaign.sol` ≥ 90%(包括 enum 状态转换分支与 cancelCampaign 全部分支)

## 3. Deploy Scripts and CLI Migration

- [x] 3.1 Update `deploy/01_deploy.ts` to call new constructor signature. Recipients sourced from `RECIPIENTS` env var (comma-separated) or fallback to `[deployer.address]` for smoke runs
- [~] 3.2 Update `scripts/cli-setup.ts` for new constructor; replace `RECIPIENT_COUNT` env with `RECIPIENTS`; derive count from list length
- [x] 3.3 Update `scripts/verify-onchain.ts`, `scripts/verify-roles.ts`, `scripts/e2e-sepolia.ts` for new ABI; print `recipientListHash` and `claimedTotalPlaintext` in verification output
- [~] 3.4 Run end-to-end on local hardhat: `npm run compile && npm test && DECLARED_TOTAL=1000 RECIPIENTS=0x...,0x... npx hardhat run deploy/01_deploy.ts` succeeds

## 4. Backend Scaffold

- [x] 4.1 Create `backend/` workspace: `package.json` with deps (express, pg, siwe, viem, jsonwebtoken, cors, dotenv, zod), `tsconfig.json`, `.env.example` listing required env vars
- [x] 4.2 Implement `backend/src/config.ts` with zod-validated config from env (PORT, DATABASE_URL, JWT_SECRET, SEPOLIA_RPC, CHAIN_ID, SIWE_DOMAIN, SIWE_NONCE_TTL_SECONDS)
- [x] 4.3 Implement `backend/src/db/schema.sql` with tables `campaigns`, `allocations`, `claims`, `campaign_drafts`, `siwe_nonces`, `kv_state` per `indexer-service` spec; idempotent CREATE TABLE IF NOT EXISTS. Implement `backend/src/db/client.ts` (pg Pool) and `backend/src/db/migrate.ts`
- [x] 4.4 Implement `backend/src/app.ts` (Express app with CORS scoped to SIWE_DOMAIN, JSON body parser, `/api/health` route) and `backend/src/server.ts` (boot wrapper)
- [~] 4.5 Verify `npm run db:migrate` creates all 6 tables in a fresh Postgres database; `npm run dev` boots and `/api/health` returns ok

## 5. Backend Auth and APIs

- [x] 5.1 Implement `backend/src/auth/siwe.ts`: `GET /api/auth/nonce` issues random nonce with TTL row in `siwe_nonces`; `POST /api/auth/siwe` validates nonce existence + expiry, calls `siwe.verify`, deletes nonce on success, issues JWT via `issueSession`
- [x] 5.2 Implement `backend/src/auth/session.ts`: `issueSession(address)` returns JWT; `requireSession` middleware extracts Bearer token, verifies, populates `req.session.address`
- [x] 5.3 Implement `backend/src/api/campaigns.ts` with public routes: `GET /api/campaigns?status=`, `GET /api/admin/:address/campaigns`, `GET /api/auditor/:address/campaigns`. Address comparisons case-insensitive, ordered by `created_at DESC`
- [x] 5.4 Add SIWE-gated `POST /api/me/campaigns` to `campaigns.ts`: joins `campaigns` × `allocations` filtered by recovered session address
- [x] 5.5 Implement `backend/src/api/drafts.ts` with SIWE-gated CRUD: POST creates draft owned by session address; GET/PUT/DELETE scoped to `owner_address` (return 404 not 403 on cross-owner access). PUT bumps `draft_version`. PUT writes only the whitelisted fields (camelCase → snake_case)
- [x] 5.6 Implement `backend/src/api/register.ts`: `POST /api/register-campaign` reads on-chain `admin()` / `auditor()` / `recipientListHash()` / `declaredTotal()` / `recipientCount()` via viem; rejects with 400 if claimed admin doesn't match chain; inserts row using chain-verified values; if `draftId` provided, updates that draft's status to `deployed`
- [x] 5.7 Implement `backend/src/chain/abi.ts` with the minimum read ABI for the V7 contract (admin, auditor, recipientListHash, declaredTotal, recipientCount, claimedTotalPlaintext, finalized)
- [x] 5.8 Add unit tests for siwe nonce flow, drafts owner scoping, register-campaign chain mismatch rejection (use mocked viem reads)

## 6. Backend Indexer Worker

- [x] 6.1 Implement `backend/src/indexer/worker.ts`: `runIndexer()` polls every 12s; reads `kv_state['indexer.last_block']`; fetches all known campaign addresses from `campaigns` table; calls `getLogs` for `AllocationSet`, `Finalized`, `Claimed`, `TokenTransferred` events in (lastBlock, tip] range
- [x] 6.2 Implement event handlers per `indexer-service` spec: AllocationSet → INSERT into `allocations` ON CONFLICT DO NOTHING; Finalized(true) → UPDATE campaign state to `claiming`; Claimed → UPSERT into `claims`; TokenTransferred → UPDATE `claims.amount` and `transferred_at_block`
- [x] 6.3 Persist `kv_state['indexer.last_block']` after each successful tick. Wire `runIndexer()` into `backend/src/server.ts` boot
- [~] 6.4 Smoke test: deploy a campaign on local hardhat or Sepolia, register via API, run worker, verify `allocations` and `claims` rows appear after corresponding events

## 7. Frontend Crypto Utilities

- [x] 7.1 Implement `frontend/src/lib/parse.ts` exporting `parseStrictUint64(s: string): bigint` per acceptance: rejects empty, commas, exponents, decimals, negatives, whitespace padding, overflow > 2^64-1; accepts plain digits up to uint64 max. Add `frontend/src/lib/parse.test.ts` covering all 9 rejection cases plus 2 accept cases
- [x] 7.2 Replace `Number(amount) > 0` at `frontend/src/pages/admin/SetAllocationForm.tsx:73` with `parseStrictUint64` + bigint comparison; same for any precision-fragile parse in `frontend/src/hooks/useTokenMeta.ts:42`. Verify no remaining `Number(` calls on user-typed amount strings
- [x] 7.3 Install `@noble/ciphers`. Implement `frontend/src/lib/draft-crypto.ts` exporting `encryptDraftAmounts(amounts, signer, scope)` and `decryptDraftAmounts(ciphertext, signer, scope)` per `draft-encryption` spec; ensure fresh random IVs every call; deriveScopeString must include all 6 scope fields with stable key order
- [x] 7.4 Add `frontend/src/lib/draft-crypto.test.ts`: round-trip preserves amounts; two encryptions of same data produce different IVs and different ciphertexts; phishing scope (different origin) fails to decrypt; cross-draft scope fails to decrypt
- [x] 7.5 Run `npm run lint` and frontend tests; all pass (vitest now in devDeps; 10 baseline lint errors documented as legacy/non-V7)

## 8. Frontend Wizard (UI tasks: goals + acceptance + reference patterns, no prescribed React/CSS)

- [x] 8.1 Install `zustand`. Implement `frontend/src/pages/wizard/state.ts` with the wizard store per `admin-deployment-flow` spec. Acceptance: store exposes `draftId`, `draftVersion`, `currentStep`, `status`, recipients, snapshot, deployStep, allocatedSoFar, plus the listed actions. Bumping version invalidates the snapshot
- [x] 8.2 Implement `frontend/src/pages/wizard/api.ts` (drafts client): `createDraft`, `saveDraft`, `loadDraft`. `saveDraft` integrates `encryptDraftAmounts` so plaintext amounts NEVER hit the network. `loadDraft` decrypts via `decryptDraftAmounts`. Acceptance: a manual call with mocked signer round-trips amounts
- [x] 8.3 Implement `frontend/src/pages/wizard/WizardLayout.tsx` (5-step progress strip + outlet). Wire 5 nested routes under `/wizard/{basics,recipients,auditor,review,deploy}` in `frontend/src/App.tsx`. Acceptance: navigating to each route renders the layout with current step highlighted
- [x] 8.4 Implement `Step1Basics.tsx`: collect name + description; show ZDT token info card (read `VITE_TOKEN_ADDRESS`, balance via wagmi). Acceptance: cannot proceed with empty name; token field is read-only display
- [x] 8.5 Implement `Step2Recipients.tsx` with L1 (per-line) + L2 (list-level) validation per `admin-deployment-flow` spec. Use `validateLineL1` and `validateListL2` helpers in `frontend/src/pages/wizard/validators.ts`. Acceptance: 9 validator unit tests pass; UI blocks Next when any error level issue exists; bumps `draftVersion` on commit
- [x] 8.6 Implement `Step3Auditor.tsx`: only auditor address input; auto-derived panel showing recipientCount / declaredTotal / largest / smallest from store. Acceptance: declaredTotal and recipientCount fields are NOT editable by user
- [x] 8.7 Implement `Step4Review.tsx`: on mount, compute `listHash = keccak256(encodeAbiParameters([{type:'address[]'}], [addresses]))` and call `setSnapshot`. Show summary sections with Edit buttons that invalidate snapshot via `bumpVersion`. Acceptance: after Edit + return, snapshot draftVersion no longer matches store draftVersion
- [x] 8.8 Implement `frontend/src/pages/wizard/deploy.ts` exporting `executeDeployment(ctx)` per `admin-deployment-flow` Step 5 spec: 5 sub-steps with progress callbacks. Use ethers ContractFactory (or viem deploy), wagmi walletClient/publicClient. Acceptance: full happy-path can deploy to local hardhat with 2-3 recipients
- [x] 8.9 Implement `Step5Deploy.tsx` rendering progress for each sub-step; call `executeDeployment` on mount; on success show shareable URLs; on failure show error with explicit "use withdrawExcess to recover funds and redeploy" remediation. Acceptance: KMS callback timeout produces actionable error UI

## 9. Frontend Auth and Pages

- [x] 9.1 Install `siwe`. Implement `frontend/src/auth/siwe-client.ts` (`siweLogin`, `getSessionToken`, `clearSession`) per `recipient-discovery` spec. Token persisted to localStorage; signature flow uses wagmi's `useSignMessage`
- [x] 9.2 Implement `frontend/src/auth/SiweButton.tsx` rendering Sign in / Sign out states. Acceptance: clicking triggers wallet sign prompt; success persists token; sign out clears it
- [x] 9.3 Implement `frontend/src/pages/Home.tsx`: section the campaign list by role (deployed / received / audited). "Deployed" and "audited" use public APIs without SIWE; "received" uses SIWE-gated `/api/me/campaigns` and only shows when session present. Acceptance: address with mixed roles sees all 3 sections populated; same address without SIWE sees only deployed + audited
- [x] 9.4 Implement `frontend/src/pages/CampaignDetail.tsx` at `/c/:address`: read `admin()` and `auditor()` from chain, compute effective role, dispatch to AdminPage / RecipientPage / AuditorPage / PublicView. URL `?role=` is hint only; actual role determined by chain reads + connected wallet. Persist campaign address to `localStorage.zd:knownCampaigns`. Acceptance: visiting `/c/0xCAMP?role=admin` with non-admin wallet shows public view, not admin powers
- [x] 9.5 Update existing `frontend/src/pages/admin/AdminPage.tsx`: add "Withdraw excess" UI calling `withdrawExcess(amount)`; show `claimedTotalPlaintext`, `balanceOf`, and `recipientListHash` (read-only badges). Acceptance: Admin can withdraw 100 ZDT excess in a test scenario
- [x] 9.6 Implement / update `frontend/src/pages/recipient/RecipientPage.tsx`: `requestMyAllocation()` → relayer SDK user-decrypt → display amount. Show claim button conditionally on finalized + not yet claimed. After claim, show pending then transferred state. Acceptance: full recipient flow on local hardhat completes and balance updates
- [x] 9.7 Implement / update `frontend/src/pages/auditor/AuditorPage.tsx` per `auditor-verification` spec: read-only metadata display; "Verify list hash" button (fetches AllocationSet events, recomputes keccak, compares to `recipientListHash`); solvency invariant displayed; per-claim KMS signature verification with ✅/❌; "Decrypt aggregate claimed total" button using relayer SDK. Acceptance: auditor view has zero on-chain mutating actions
- [x] 9.8 Implement `frontend/src/pages/PublicView.tsx`: show metadata + progress bar (claimedTotalPlaintext / declaredTotal). No interactions

## 10. Documentation Updates

- [x] 10.1 Update `docs/SECURITY.md` to add the V7 "Privacy Boundary" section per `privacy-boundary` spec: 4 sub-sections (What's Protected, What's NOT Protected, Trust Model, V8+ Roadmap). Use threshold MPC terminology, NOT "validators"
- [x] 10.2 Update homepage hero copy in `frontend/src/pages/Home.tsx` to display the honest privacy claim sentence (Chinese + English) and link to SECURITY.md
- [x] 10.3 Update `README.md`: replace any "confidential airdrop" / "private allocations" hyperbole with V7-accurate framing pointing to SECURITY.md
- [x] 10.4 Add "Superseded by V7" banner at the top of `docs/role-page-protocol.md` linking to this change's specs

## 11. End-to-End Verification

- [ ] 11.1 Manual e2e on Sepolia: connect wallet → SIWE → wizard with 2 real recipients → deploy → claim from recipient wallet → audit from auditor wallet. Document any rough edges as follow-up issues
- [x] 11.2 Run all test suites: `npm test` (contracts), backend `npm test`, frontend `npx vitest run`. All green (57+16+14 = 87 tests passing as of Wave 2/3a completion)
- [x] 11.3 Run `openspec validate v7-dapp-wizard --strict` (the openspec spec validator, if available) and resolve any warnings

## 12. Ship

- [ ] 12.1 Push branch and open PR titled "feat: V7 dApp wizard + indexer + privacy honest" (English commit/PR per project convention)
- [ ] 12.2 After PR merges, run `openspec archive v7-dapp-wizard` to migrate the `specs/*/spec.md` files into `openspec/specs/` as the new authoritative capability specs
