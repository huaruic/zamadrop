# Change 003: Sepolia 部署

**状态**: DONE  
**日期**: 2026-05-02  
**网络**: Sepolia testnet (chainId 11155111)  

## 部署结果

| 合约 | 地址 | Etherscan |
|------|------|-----------|
| MockToken (ZDT) | `0x0Daa19d2924b434FBBC5e10d7348037DeF843680` | [查看](https://sepolia.etherscan.io/address/0x0Daa19d2924b434FBBC5e10d7348037DeF843680) |
| ZamaDropCampaign | `0x2d885c691cEE007ddCE0D1b0d3fC43318B6F9D60` | [查看](https://sepolia.etherscan.io/address/0x2d885c691cEE007ddCE0D1b0d3fC43318B6F9D60) |

**部署参数**：
- Deployer / Admin: `0x0000000000000000000000000000000000000000`
- Auditor: 同 Deployer（MVP 阶段）
- Declared total: 1000 ZDT
- Recipient count: 2
- Escrow funded: 1000 ZDT 已转入 Campaign

## 部署过程教训

### Bug 1: 空字符串 fallback
`.env` 里 `AUDITOR_ADDRESS=`（空字符串）时，`process.env.AUDITOR_ADDRESS ?? defaultValue` 不会触发默认值——`??` 只对 null/undefined 生效，空字符串是 truthy。结果 ethers.js 把空串当 ENS 域名解析，抛 `NotImplementedError`。  
**修复**：在 deploy 脚本里加 `nonEmpty()` 辅助函数显式过滤空串。

### 经验：失败重试要支持复用部分产物
第一次部署 MockToken 成功但 Campaign 失败后，如果直接重跑会浪费 gas 重新部署 MockToken。修复时加了 `EXISTING_TOKEN_ADDRESS` 环境变量，可复用已部署的合约。在 hackathon 时间紧、gas 有限的场景下这种"幂等性"设计很值。

## Gas 消耗
约 0.0026 SepoliaETH 完成所有部署。钱包剩余 0.04999... SepoliaETH，足够后续 setAllocation / finalize / claim / executeTransfer 的全链路演示。

## 下一步
- Day 5：Frontend 接入这两个地址（已写入 `deployments/sepolia.json`）
- Day 6：链下 oracle 监听 `ClaimRequested` 事件并解密
- Day 7：在 Sepolia 上跑一次完整的 setAllocation → finalize → claim → executeTransfer 流程，留作视频素材
