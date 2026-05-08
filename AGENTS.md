# ZamaDrop — AGENTS.md

## 项目概述

机密代币分发协议，基于 Zama fhEVM（FHE）。
合约用 Solidity + `@fhevm/solidity ^0.11.1`，测试用 Hardhat + TypeScript + fhEVM mock。

## 验证命令

```bash
npm run compile  # 先编译合约
npm test        # 用 fhEVM mock 运行 Hardhat 测试
npm run lint
```

## 重要：FHE API 命名

使用 `FHE.xxx`，**不是** `TFHE.xxx`（旧版）：
```solidity
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
FHE.add / FHE.eq / FHE.allow / FHE.allowThis / FHE.fromExternal
```

## 核心合约

`contracts/ZamaDropCampaign.sol`

关键函数：`setAllocation` / `finalize` / `callbackFinalize` / `claim` / `requestMyAllocation` / `requestClaimedTotalForAuditor`

## 项目记忆入口

长期规则在本文件；重要变更走 OpenSpec；长期技术决策写 ADR；踩坑写
`docs/LEARNINGS.md`；交接状态写 `docs/WORKLOG.md`。完整分层说明见
`docs/PROJECT_MEMORY.md`。

改核心行为前按顺序读：

1. `AGENTS.md`
2. `openspec list`
3. 当前 active change 的 `proposal.md` / `design.md` / `tasks.md`
4. 相关 `openspec/changes/<change>/specs/*/spec.md`
5. 相关 `docs/ADR/*.md` 和 `docs/LEARNINGS.md`
6. 代码

小 typo / lint / 窄测试改动可以不建 OpenSpec；合约行为、FHE/KMS、claim/finalize、
前端核心流程、后端/indexer/API、隐私边界变更必须走 OpenSpec。

## 命名约定：V6 / V7 / V8 是**内部 milestone 标签** ≠ 公开 semver

- **公开发布版本**走 README Roadmap 的 `v0.x` / `v1` / `Beyond` 三段式（小写 v + 数字），跟 npm semver 一致。
- **`V6` / `V7` / `V8`**（大写 V）只是**内部 milestone 名**，对应 OpenSpec change 分组：
  - V1-V5：早期讨论过的 role/page IA 变体（见 `docs/role-page-protocol.md`），4 个被丢弃，V5 残骸在 `openspec/changes/archive/005-frontend/`
  - V6：当前生产形态的 4-tab 能力页 IA（capability strip + always-visible tabs）
  - V7：dApp wizard + 后端 indexer + active-pull KMS 架构（本 milestone 的 `v7-dapp-wizard` OpenSpec change）
  - V8：finalize-recovery escape hatch + bulk-allocation 大规模 N（待做）
- 所以 PR 标题里的 "V7" **不是 v7.0.0 release**，是"我们的第 7 次 milestone"。这是个 unprincipled 历史包袱，不要新增 V 前缀的 change-id；新 OpenSpec change 直接用描述性命名（`bulk-allocation` / `auditor-multisig`），把 "V8" 留作非正式口语指代当前 milestone 组。

## 关键不变量（改合约前必读）

1. **Allocations 只能设置一次** — `setAllocation` / `setAllocationsBatch` 对同一 recipient 设置两次都会 revert（共用 `allocationSet[]` flag）
2. **`claim()` 是原子的** — 先设 `claimed[addr] = true` 再转账，任意一步 revert 会回滚整个调用
3. **`claimedTotal` 只在 `claim()` 中更新** — 其他地方不会更新
4. **`setAllocationsBatch` 单批上限 = 16 recipients,不是合约层守卫** —
   绑定约束是 FHEVM **HCU (Homomorphic Computation Unit) per-tx budget**:
   loop body 里 `FHE.add(_runningTotal, amount)` 每次消耗 depth, batch=32
   实测 revert `HCUTransactionDepthLimitExceeded()`(2026-05-08 验证),
   batch=16 是当前 FHE op pattern 下验证过的最大值。Zama relayer SDK 的
   `createEncryptedInput` 本身允许 32 个 uint64 (2048/64), Sepolia 30M
   block gas 在 16 × 500k ≈ 8M 处也留足空间, 但都不是 binding 约束。
   合约本身接受任意长度 array, 但 frontend / CLI 必须切片到 ≤ 16。
   **这是协议层硬限,不是可调常量** — 想 bump 必须 Zama 改 HCU budget 或
   减少 FHE.add depth, 不是项目内决策。

5. **KMS 验证用 active pull,不要被动等 Gateway push** — finalize() 会
   把加密的 sumCheck handle 标记为 publicly decryptable 并存到
   `finalizeCheckHandle`。任何代码（包括 wizard frontend）都应该用
   relayer SDK `publicDecrypt(handles)` 主动询问 Gateway 拿到 threshold
   MPC 签名的解密结果，然后自己提交 `callbackFinalize(result, proof)`。
   被动监听 `Finalized` 事件不可靠 — Gateway 在 Sepolia 偶尔 missed
   event subscription 会让 campaign 卡 Finalizing 状态。Active pull
   端到端 ~10-15s（~3-10s MPC + ~12s 区块）。
   参考实现：`scripts/recover-stuck-finalize.ts`、
   `frontend/src/pages/wizard/deploy.ts` 的 `pullAndCallback`。

## 前端开发

```bash
cd frontend
npm install   # 或 bun install
npm run dev   # Vite dev server on 5173
npm run build # tsc -b + vite build
npm run lint
```

## KMS 回调由前端主动 pull(ADR 0003)

V7 不再依赖独立的 executor 服务。`finalize` 后的 callbackFinalize、`claim`
后的 executeTransfer 都由触发该流程的前端钱包主动用 relayer SDK
publicDecrypt 拿 KMS 签名 + 自己提交。共享 util:
`frontend/src/lib/kms-active-pull.ts`。CLI 端用
`hre.fhevm.publicDecrypt` 在 `scripts/cli-setup.ts`、
`scripts/recover-stuck-finalize.ts` 同一模式。

## 不做（MVP 范围外）

Merkle proof / vesting / factory / ERC7984（stretch） / 跨链 / KYC

## 信任假设

详见 [`docs/SECURITY.md`](./docs/SECURITY.md)。`callbackFinalize` 与
`executeTransfer` 通过 `FHE.checkSignatures` 校验 KMS threshold 签名，
任何账户都可调但伪造 amount / bool 会 revert。V7 起这两个 callback 由
触发流程的前端钱包主动提交（ADR 0003），不再依赖外部 executor 服务。

## 文档落点规则

不要在 `docs/` 下创建临时计划、brainstorm、agent 自动生成草稿或工具输出。
尤其禁止创建 `docs/superpowers/`(已 .gitignore)。

| 内容类型 | 落点 |
|---|---|
| 产品 / 协议 / 前端核心流程 / 后端 / executor / 隐私边界变更 | `openspec/changes/<change-id>/` |
| 长期技术决策 | `docs/ADR/` |
| 安全与信任边界 | `docs/SECURITY.md`(配合 OpenSpec) |
| 调试结论和踩坑 | `docs/LEARNINGS.md` |
| 短期交接状态 | `docs/WORKLOG.md` |
| 部署和运维步骤 | `docs/RUNBOOKS/` |
| 测试策略 | `test/TEST_PLAN.md` |
| 产品基线 PRD | `docs/product/` |
| 子项目开发指南 | `frontend/README.md` |
| 永久 agent 规则 | 本文件 |

临时草稿只允许放 `.private/`(本地,不入库)。若草稿内容有长期价值,**必须先归并到上面某个正式位置后再删除草稿**。
