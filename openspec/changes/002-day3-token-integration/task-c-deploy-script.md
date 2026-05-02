# Task C: 部署脚本

## Goal
新建 `deploy/01_deploy.ts`，可在本地（hardhat）和 Zama testnet 上一键部署完整系统。

## 输入契约
- `contracts/MockToken.sol` 已存在
  - constructor: `(string name, string symbol, uint64 initialSupply, address admin)`
  - admin 自动获得 initialSupply
  - 有 `mint(address to, uint256 amount)` (admin only)
- `contracts/ZamaDropCampaign.sol` 已更新
  - constructor: `(uint64 _declaredTotal, uint64 _recipientCount, address _auditor, address _token)`
  - 有 `IERC20 public immutable token` 状态
- 已配置 dotenv，`.env.example` 给出参数模板
- Hardhat 配置已有 `zamaTestnet` 网络，从 process.env 读取 RPC 和 PRIVATE_KEY

## 输出契约

### 新建 `deploy/01_deploy.ts`

脚本流程：
1. 用 `ethers.getSigners()` 拿到 deployer（admin）账户
2. 读取参数（带默认值）：
   - `DECLARED_TOTAL` (default: 1000)
   - `RECIPIENT_COUNT` (default: 2)
   - `AUDITOR_ADDRESS` (default: deployer.address)
3. 部署 MockToken：name="ZamaDrop Test Token"，symbol="ZDT"，initialSupply=DECLARED_TOTAL，admin=deployer
4. 部署 ZamaDropCampaign：传入 token.address
5. admin 调用 `token.transfer(campaign.address, declaredTotal)` 把 escrow 转入 campaign
6. console.log 输出：
   - MockToken 地址
   - ZamaDropCampaign 地址
   - 配置参数
   - admin / auditor 地址
   - 运行说明（前端如何用这些地址）

### 用法
```bash
# 本地
npx hardhat run deploy/01_deploy.ts

# Zama testnet
npx hardhat run deploy/01_deploy.ts --network zamaTestnet
```

### 不可越界
- ❌ 不要修改 `contracts/`、`test/`、`hardhat.config.ts`
- ❌ 不要 commit
- ❌ 不要使用 hardhat-deploy 的复杂模式（保持单文件简单脚本）

## 验证
```bash
npx hardhat run deploy/01_deploy.ts
```
应输出两个合约地址、escrow 转账成功、不报错。

## 完成回报
- 脚本文件路径
- 本地运行的输出（合约地址、转账成功）
- 是否处理了缺失环境变量的默认值
