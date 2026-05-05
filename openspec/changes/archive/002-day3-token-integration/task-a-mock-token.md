# Task A: MockToken ERC20

## Goal
创建一个简单的 ERC20 测试代币，用于 ZamaDropCampaign 的 escrow 和 claim 转账。

## 输入契约
- 已安装依赖：`@fhevm/solidity ^0.11.1`
- 没有 OpenZeppelin contracts 依赖（需要先安装）
- Solidity ^0.8.24

## 输出契约（必须满足）
1. **新增文件**：`contracts/MockToken.sol`
2. 合约必须有：
   - `constructor(string memory name, string memory symbol, uint64 initialSupply, address admin)` — 部署时给 admin mint 初始供应量
   - 标准 ERC20 接口（`transfer`, `balanceOf`, `approve`, `transferFrom` 等）
   - 可选：`mint(address to, uint256 amount)` 公开方法（仅 admin 可调用），方便测试
3. 安装依赖：`npm install --save-dev @openzeppelin/contracts`（推荐用 OpenZeppelin 的 ERC20）
4. 编译通过：`npx hardhat compile` 必须成功

## 不可越界
- ❌ 不要修改 `contracts/ZamaDropCampaign.sol`
- ❌ 不要修改 `test/` 下任何文件
- ❌ 不要修改 `hardhat.config.ts`
- ❌ 不要 commit（主线程统一 commit）

## 验证
```bash
npm install --save-dev @openzeppelin/contracts
npx hardhat compile
```
应输出 `Compiled X Solidity files successfully` 且包含 MockToken。

## 完成回报
回报内容：
- 是否新增了 OpenZeppelin 依赖
- MockToken 的关键 API 签名（如有自定义 mint 函数）
- 编译输出
