# ZamaDrop — AGENTS.md

## 项目概述

机密代币分发协议，基于 Zama fhEVM（FHE）。
合约用 Solidity + `@fhevm/solidity ^0.11.1`，测试用 Hardhat + TypeScript + fhEVM mock。

## 重要：FHE API 命名

使用 `FHE.xxx`，**不是** `TFHE.xxx`（旧版）：
```solidity
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
FHE.add / FHE.eq / FHE.allow / FHE.allowThis / FHE.fromExternal
```

## 验证命令

```bash
npm run compile
npm test
npm run lint
```

## 核心合约

`contracts/ZamaDropCampaign.sol`

函数：`setAllocation` / `finalize` / `callbackFinalize` / `claim` / `requestMyAllocation` / `requestClaimedTotalForAuditor`

## 不做（MVP 范围外）

Merkle proof / vesting / factory / ERC7984（stretch） / 跨链 / KYC

## 信任假设

详见 [`docs/SECURITY.md`](./docs/SECURITY.md)。`callbackFinalize` 与
`executeTransfer` 通过 `FHE.checkSignatures` 校验 KMS threshold 签名，
任何账户都可调但伪造 amount / bool 会 revert。
