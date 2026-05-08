## Why

ZamaDrop V6 ship 后用户实际无法独立创建 campaign —— 必须工程师跑 `scripts/cli-setup.ts` 部署后把地址硬编码进 `frontend/src/config.ts`,产品体验跟"工程脚本"无异。同时 Codex 4 轮对抗 review 揪出 9 处合约级 bug(admin 错位 / recipientCount 装饰品 / escrow 不强制 / 多余 token 卡死 / SafeERC20 缺失 / BigInt 精度漂移 / 签名歧义等),这些都是阻碍 V7 上 mainnet 的硬阻塞。本 change 同时解决"产品形态"和"合约正确性"两件事。

## What Changes

- **BREAKING**: 合约 constructor 签名重构 —— 加 `admin_` 显式参数,加 `recipients[]` + `listHash` 校验,移除从 `msg.sender` 推导 admin
- **BREAKING**: 部署脚本 (`deploy/01_deploy.ts` / `scripts/cli-setup.ts` / 等)按新 ABI 调用
- 新增 5 步 wizard(浏览器内连钱包 → token 自动派生 → 上链直接部署),取代 CLI 部署
- 新增 SIWE-鉴权 indexer 后端,支持 Recipient "连钱包看我能领什么"自查
- 新增 Auditor 只读视图(settlement integrity + solvency check + 单笔 KMS 签名校验)
- 新增 DEK+KEK 信封加密的草稿存储(后端永远拿不到金额明文)
- 新增 `recipientListHash` immutable + `allocationCount` 计数 + `claimedTotalPlaintext` 累加器
- 新增 `withdrawExcess()`(Option C:任何状态可调,数学保证 recipient 应得不被动)
- **BREAKING**: 合约新增显式 `enum State` 取代 `bool finalized`(状态:Setup / Finalizing / Claiming / Failed)
- 新增 `cancelCampaign()` 函数:仅 Admin 可调,仅 `Failed` 状态下生效,把合约 balance 全部退回 admin
- `withdrawExcess` 限定在 `Claiming` 状态下使用;`Failed` 状态走 `cancelCampaign`
- 新增 `finalize()` 内 `balanceOf >= declaredTotal` escrow 强制
- 替换 `executeTransfer` 的 `require(token.transfer(...))` 为 `SafeERC20.safeTransfer`
- 修现存 BigInt 精度 bug (`SetAllocationForm.tsx:73`、`useTokenMeta.ts:42`)
- 文档诚实化:`SECURITY.md` 显式声明"amount-at-rest privacy ✅,membership privacy ❌,claim-time amount privacy ❌"

## Capabilities

### New Capabilities

- `campaign-contract`: 合约层规格 —— constructor 接受显式 admin、不可变 recipientListHash、allocationCount/recipientCount 不变式、escrow 强制、Option C withdrawExcess、SafeERC20、claimedTotalPlaintext 公开累加器、KMS 签名校验
- `admin-deployment-flow`: Admin 5 步 wizard —— Basics / Recipients / Auditor(自动派生)/ Review(snapshot 锁)/ Deploy(钱包直接部署 + escrow + setAllocation × N + finalize + KMS callback)
- `recipient-discovery`: SIWE 鉴权 indexer 自查 —— 连钱包 + 签 SIWE 消息(零 gas)→ POST `/api/me/campaigns` → 返回该地址在 AllocationSet 事件里出现的所有 campaign。诚实定位为"防滥用 + UX",非隐私层
- `auditor-verification`: Auditor 只读视图 —— recipientListHash 独立验算、`balance >= declaredTotal - claimedTotalPlaintext` 偿付不变式、单笔 KMS 签名校验、可选解密 `_claimedTotal` 聚合值
- `draft-encryption`: DEK+KEK 信封加密 —— 客户端随机 DEK 加密金额、wallet 签名派生 KEK 包装 DEK、scope 含 chainId/origin/admin/draftId/createdAt/purpose 防钓鱼。后端只存密文
- `indexer-service`: 后端 Express + Postgres + viem —— SIWE auth、campaigns/allocations/claims 事件订阅、drafts CRUD、register-campaign 端点(链上验真 admin)
- `privacy-boundary`: 隐私边界文档与 UI copy —— homepage、SECURITY.md、role-page-protocol.md 统一表述。明确不打"membership privacy"这张牌,把 KMS 措辞从"validators"校准成"threshold MPC parties"

### Modified Capabilities

(无 —— 项目此前 `openspec/specs/` 为空,本 change 是首批 capability 落盘)

## Impact

- **Affected code (合约层)**: `contracts/ZamaDropCampaign.sol` (constructor / setAllocation / finalize / executeTransfer 全部签名变更),新增 `withdrawExcess` 函数;`contracts/MockToken.sol` 不变
- **Affected code (链下 + 测试)**: `deploy/01_deploy.ts`、`scripts/cli-setup.ts`、`scripts/verify-onchain.ts`、`scripts/verify-roles.ts`、`scripts/e2e-sepolia.ts` 全部按新 ABI 重写;`test/ZamaDropCampaign.test.ts` 26 个用例的 deploy helper 需迁移 + 新增 ~12 个用例覆盖新不变式
- **Affected code (前端)**: 修现存 BigInt 精度 bug(`SetAllocationForm.tsx:73`、`useTokenMeta.ts:42`);新增 `frontend/src/lib/{parse,draft-crypto}.ts` 及测试;新增 `frontend/src/pages/wizard/*` 5 个 step 组件 + state store + drafts API client;新增 `frontend/src/auth/siwe-client.ts` + `SiweButton.tsx`;`frontend/src/pages/CampaignDetail.tsx` 路由分发逻辑改造
- **新增子系统**: `backend/`(Express + Postgres + viem indexer worker + SIWE)
- **依赖新增**:
  - 合约: `@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol`(已在 OZ 包内)
  - 前端: `siwe`、`zustand`、`@noble/ciphers`
  - 后端: `express`、`pg`、`siwe`、`viem`、`jsonwebtoken`、`zod`
- **配置/部署**: 新增 `backend/.env.example`(`DATABASE_URL`、`JWT_SECRET`、`SEPOLIA_RPC` 等);前端新增 `VITE_BACKEND_URL`
- **不在本 change 范围**(明确推 V8+): Factory 合约、euint128 升级、multi-token / token selector、membership privacy(commitments/nullifiers)、pause/cancel/time-lock、批量 setAllocation、Safe / EIP-4337 原生支持
