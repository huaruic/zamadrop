# ZamaDrop — CLAUDE.md

## 项目概述

机密代币分发协议，基于 Zama fhEVM（Fully Homomorphic Encryption）。
用 FHE 加密每个受益人的 allocation，在密文状态下验证总量约束，实现"campaign 级别透明，个人级别保密"。

**黑客松截止**：2026-05-10 23:59 AOE（Zama Protocol Bounty）

## 技术栈

- **合约**：Solidity ^0.8.24，`@fhevm/solidity` ^0.11.1
- **开发框架**：Hardhat ^2.28.4，TypeScript
- **FHE 测试**：`@fhevm/mock-utils` ^0.4.2，`@fhevm/hardhat-plugin` ^0.4.2
- **前端（后期）**：Next.js / Vite + React，`@zama-fhe/relayer-sdk` ^0.4.1，wagmi + viem
- **Node.js**：≥20

## FHE API（关键，与旧文档不同）

当前版本使用 `FHE.xxx`，**不是** `TFHE.xxx`：

```solidity
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// 接收客户端加密输入
euint64 val = FHE.fromExternal(encInput, proof);

// 算术
euint64 sum = FHE.add(a, b);

// 比较（返回 ebool）
ebool eq = FHE.eq(a, b);

// 权限
FHE.allowThis(handle);          // 合约自身可读
FHE.allow(handle, addr);        // 指定地址可读/解密
FHE.allowForDecryption(handle); // 允许 Gateway 公开解密
```

## 合约架构

核心合约：`contracts/ZamaDropCampaign.sol`

```
角色：Admin（部署/设置）/ Recipient（查看+领取）/ Auditor（聚合统计）/ Public（只读）

状态机：Setup → Finalized → Claiming
- setAllocation()：Admin 逐个设置，同步累加 runningTotal（增量模式）
- finalize()：FHE.eq(runningTotal, declaredTotal) → Gateway callback → finalized=true
- claim()：check→set→FHE.add(claimedTotal)→transfer，原子执行
- requestMyAllocation()：返回密文 handle，前端 re-encrypt 解密
- requestClaimedTotalForAuditor()：Gateway 解密 claimedTotal，仅 Auditor
```

## 验证命令

```bash
npm run compile        # 编译合约
npm test               # 运行 Hardhat 测试（fhEVM mock）
npm run coverage       # 覆盖率
npm run lint           # 代码检查
```

## 关键约束（开发前必读）

1. **allocation 只能追加**：`setAllocation` 对同一地址第二次调用必须 revert
2. **claim 原子性**：先 `claimed[addr]=true` 再做 FHE 操作再 transfer，整体 revert 防双花
3. **claimedTotal 只在 `claim()` 里更新**，不在其他地方累加
4. **Gateway callback 延迟**：Testnet 上 finalize 的 callback 需要 1-3 个区块，Demo 时提前执行
5. **Gas 测量**：`claim()` 含两次 FHE 操作，Day 1 必须测量，超 3M gas 要拆分

## 设计文档

位于：`~/.gstack/projects/zamaDrop/internal-design-note.md`

## 当前进度（每次完成阶段后更新）

### ✅ 已完成
- **Day 1-2**：`contracts/ZamaDropCampaign.sol` 核心合约 + 18 测试全绿
- **Day 3**：
  - `contracts/MockToken.sol`：OpenZeppelin ERC20 测试代币
  - ZamaDropCampaign 增加 `IERC20 token` 状态、`claim()` 标记可公开解密、`executeTransfer()` 实际转账
  - `deploy/01_deploy.ts`：部署脚本（本地 + Sepolia 已验证）
  - `hardhat.config.ts`：dotenv + Sepolia 网络配置
  - `.env.example`：环境变量模板
  - 测试扩展到 23 个，全绿
- **Day 4**：✅ Sepolia 部署完成
  - MockToken: `0x0Daa19d2924b434FBBC5e10d7348037DeF843680`
  - ZamaDropCampaign: `0x2d885c691cEE007ddCE0D1b0d3fC43318B6F9D60`
  - 完整地址记录在 `deployments/sepolia.json`
- **Day 4.5**：✅ Sepolia 端到端实战验证（`scripts/e2e-sepolia.ts`）
  - 完整跑通：setAllocation × 2 → finalize → publicDecrypt → callbackFinalize → claim → publicDecrypt → executeTransfer
  - 6 笔真实交易上链，ZDT 600 到账
  - **前提条件 #2 #5 实测通过**，KMS 公开解密 30~60s
  - 交易记录：`openspec/changes/004-e2e-sepolia-validation.md`

### 🔲 下一步（按优先级）
1. **Day 6**：浏览器实战：从 frontend 真实跑通四角色流程，可能需要修 bug
2. **Day 7**：README + 架构图 + Demo 脚本排练
3. **Day 8**：录制 2 分钟真人出镜视频

### Day 5 已完成
- Frontend：Vite + React 19 + wagmi v3 + @zama-fhe/relayer-sdk
- 四个标签：Public / Admin / Recipient / Auditor
- 端到端核心流程已布线，dev server 在 localhost:5173

### 启动 Frontend
```bash
cd frontend && npm run dev
```

### ⚠️ 待确认的技术细节
- `callbackFinalize(bool)` 和 `executeTransfer(uint64)` 目前无签名验证，Testnet 部署前需要加 KMS 签名校验（或文档说明 MVP 信任假设）
- Zama testnet RPC URL 和 chainId 需以官方文档为准（当前 .env.example 是占位符）
- `executeTransfer` 由谁调用：MVP 用前端轮询 + 链下脚本，生产应有专用 oracle

## 不做（MVP 范围外）

- Merkle proof 资格验证
- vesting 线性解锁
- 多 campaign factory
- ERC7984（Stretch Goal，Day 6 有余力再接）
- 隐藏"是否已领取"的 bool 状态
- CSV 批量导入
