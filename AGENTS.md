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
executor、前端核心流程、后端/indexer/API、隐私边界变更必须走 OpenSpec。

## 关键不变量（改合约前必读）

1. **Allocations 只能设置一次** — `setAllocation` 对同一 recipient 调用两次会 revert
2. **`claim()` 是原子的** — 先设 `claimed[addr] = true` 再转账，任意一步 revert 会回滚整个调用
3. **`claimedTotal` 只在 `claim()` 中更新** — 其他地方不会更新
4. **Gateway 回调延迟** — testnet finalize 需要 1-3 区块，建议 demo 时提前 finalize

## 前端开发

```bash
cd frontend
npm install   # 或 bun install
npm run dev   # Vite dev server on 5173
npm run build # tsc -b + vite build
npm run lint
```

## Executor（链下 settlement）

```bash
npm run executor          # Sepolia
npm run executor:local   # local hardhat network
```

## 不做（MVP 范围外）

Merkle proof / vesting / factory / ERC7984（stretch） / 跨链 / KYC

## 信任假设

详见 [`docs/SECURITY.md`](./docs/SECURITY.md)。`callbackFinalize` 与
`executeTransfer` 通过 `FHE.checkSignatures` 校验 KMS threshold 签名，
任何账户都可调但伪造 amount / bool 会 revert。

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
