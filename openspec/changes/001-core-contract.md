# Change 001: ZamaDropCampaign 核心合约实现

**状态**: DONE  
**日期**: 2026-05-02  
**Git commit**: `feat: scaffold ZamaDropCampaign with FHE allocation privacy`

## 实现内容

### 合约：`contracts/ZamaDropCampaign.sol`

FHE 操作用到的 @fhevm/solidity ^0.11.1 API：
- `FHE.fromExternal(externalEuint64, bytes)` — 接收客户端加密输入
- `FHE.add(euint64, euint64)` — 增量累加 runningTotal
- `FHE.eq(euint64, euint64)` — finalize 总量验证（返回 ebool）
- `FHE.makePubliclyDecryptable(ebool)` — 允许公开解密
- `FHE.allow(handle, addr)` / `FHE.allowThis(handle)` — 权限控制

关键架构决策：
- **增量累加**（方案 A）：每次 setAllocation() 同步 FHE.add()，finalize = O(1)
- allocation 只能追加（`allocationSet` mapping 防重复）
- claimedTotal 只在 `claim()` 里更新，单一数据源
- Auditor 地址在 constructor 设置，不可更改

### 测试：`test/ZamaDropCampaign.test.ts`

18 个测试，全绿。覆盖：
- 正常路径：deploy → setAllocation → finalize → requestMyAllocation → claim → requestClaimedTotalForAuditor
- 权限隔离：受益人无法解密他人 allocation
- 错误路径：NotAdmin / NotAuditor / NotFinalized / AlreadyFinalized / AllocationAlreadySet / NoAllocation / AlreadyClaimed

## 下一个 Change

**002**: 部署脚本 + ERC20 token transfer 接入 + Testnet 部署
