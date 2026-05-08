# ZamaDrop 部署指南

## 关键事实

- Zama Protocol 当前部署在**标准 Sepolia testnet**（chainId 11155111），不是 Zama 自己的 devnet。
- 我们用普通 Sepolia ETH 付 gas，普通 Sepolia 钱包即可。
- FHE 操作的协处理器（ACL、KMSVerifier、FHEVMExecutor、Decryption Oracle）由 `ZamaEthereumConfig` 自动提供地址，无需手动配置。

---

## 第 1 步：准备测试钱包

**强烈建议新建一个专用钱包**，不要用日常钱包：

1. 打开 MetaMask → 创建新账户（不是导入）
2. 复制账户地址（公开，可以贴出来）
3. 导出私钥（**绝密，永远不要发任何人**）
   - MetaMask → 账户菜单 → 账户详情 → 显示私钥

## 第 2 步：领 Sepolia ETH

部署 + escrow 转账 + 几次 finalize/claim 大约需要 0.05 SepoliaETH。

推荐 faucet：

| Faucet | 额度 | 要求 |
|--------|------|------|
| [Google Cloud Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) | 0.05 ETH/天 | Google 账号 |
| [Alchemy Sepolia Faucet](https://www.alchemy.com/faucets/ethereum-sepolia) | 0.5 ETH/天 | 主网有 0.001 ETH |
| [Infura Sepolia Faucet](https://www.infura.io/faucet/sepolia) | 0.5 ETH/天 | Infura 账号 |
| [QuickNode Sepolia Faucet](https://faucet.quicknode.com/ethereum/sepolia) | 0.05 ETH/12h | 主网有少量 ETH |

## 第 3 步：配置 `.env`

在项目根目录新建 `.env`（已 gitignore，不会进 git）：

```bash
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
PRIVATE_KEY=0x你的私钥
AUDITOR_ADDRESS=
```

## 第 4 步：部署

```bash
npx hardhat run deploy/01_deploy.ts --network sepolia
```

输出示例：
```
MockToken deployed at: 0x...
ZamaDropCampaign deployed at: 0x...
Escrow transferred: 1000 ZDT
```

记下两个合约地址，前端会用到。

## 第 5 步：验证部署

在 [Sepolia Etherscan](https://sepolia.etherscan.io) 输入合约地址，应看到合约创建交易。

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `insufficient funds for gas` | 钱包没 SepoliaETH | 去 faucet 领 |
| `invalid private key` | `.env` 里 PRIVATE_KEY 格式错 | 必须以 `0x` 开头，64 个十六进制字符 |
| `network sepolia not found` | hardhat.config.ts 没改对 | 确认 `networks.sepolia` 配置存在 |
| `transaction underpriced` | gas price 不够 | 部署脚本里加 `gasPrice` 选项，或换 RPC |
