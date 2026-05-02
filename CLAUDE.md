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

## 不做（MVP 范围外）

- Merkle proof 资格验证
- vesting 线性解锁
- 多 campaign factory
- ERC7984（Stretch Goal，Day 6 有余力再接）
- 隐藏"是否已领取"的 bool 状态
- CSV 批量导入
