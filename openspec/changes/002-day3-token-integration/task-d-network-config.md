# Task D: Hardhat 网络配置 + dotenv

## Goal
为 `hardhat.config.ts` 增加 Zama testnet 配置和 dotenv 支持，以及一份 `.env.example`。

## 输入契约
- 当前 `hardhat.config.ts` 已配置 hardhat 本地网络
- 项目根目录有 `package.json`，已安装 `hardhat ^2.28.4`、`@fhevm/hardhat-plugin`

## 输出契约

### 1. 安装 dotenv
```bash
npm install --save-dev dotenv
```

### 2. 修改 `hardhat.config.ts`
- 在文件顶部 import dotenv 并 config：
  ```ts
  import * as dotenv from "dotenv";
  dotenv.config();
  ```
- 在 `networks` 中新增 `zamaTestnet`：
  ```ts
  zamaTestnet: {
    url: process.env.ZAMA_TESTNET_URL || "https://devnet.zama.ai",
    accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    chainId: parseInt(process.env.ZAMA_TESTNET_CHAIN_ID || "8009"),
  },
  ```
  说明：chainId 和 URL 是占位符。Zama 当前 testnet（2026 年）以官方文档为准；先用占位符，部署时可被环境变量覆盖。
- **不要**改 solidity 配置、paths、typechain、gasReporter

### 3. 新增文件 `.env.example`
```
# Zama Testnet 部署配置（复制为 .env 并填入真实值）
ZAMA_TESTNET_URL=https://devnet.zama.ai
ZAMA_TESTNET_CHAIN_ID=8009
PRIVATE_KEY=0x...

# 部署时的合约参数（可选）
DECLARED_TOTAL=1000
RECIPIENT_COUNT=2
AUDITOR_ADDRESS=0x...
```

### 4. 验证
- `npx hardhat compile` 仍然成功（不能破坏现有编译）
- `npx hardhat test` 仍然成功（hardhat 本地网络不受 zamaTestnet 配置影响；但**注意**：如果 Task B 已修改了 ZamaDropCampaign 的 constructor，测试会失败——这与你无关，是 Task E 的问题）

## 不可越界
- ❌ 不要修改 `contracts/` 下任何文件
- ❌ 不要修改 `test/` 下任何文件
- ❌ 不要修改 `package.json` 的 scripts 字段（只能加依赖）
- ❌ 不要 commit（主线程统一 commit）
- ❌ 不要把真实的 `.env` 文件 commit 进 git（项目已有 .gitignore 包含 .env）

## 完成回报
- 修改的文件列表
- 新增的依赖
- `.env.example` 的内容
- `npx hardhat compile` 输出
