# Task B: ZamaDropCampaign Token 集成

## Goal
在 ZamaDropCampaign 中加入真实 ERC20 token 转账逻辑，采用"用户授权公开解密"模式：claim 时把该用户的 allocation 标记为可公开解密，链下 oracle 解密后调用 `executeTransfer` 实际转账。

## 输入契约
- 当前合约位于 `contracts/ZamaDropCampaign.sol`，已编译通过、18 测试全绿
- FHE API 来自 `@fhevm/solidity ^0.11.1`（用 `FHE.xxx`，不是 `TFHE.xxx`）
- 用 OpenZeppelin 的 `IERC20` 接口（不要假设 MockToken 已存在，但你需要这个接口；OpenZeppelin contracts 会由 Task A 安装）
- 现有 constructor 签名：`constructor(uint64 _declaredTotal, uint64 _recipientCount, address _auditor)`

## 输出契约（必须满足）

### 1. 修改 `contracts/ZamaDropCampaign.sol`

**新增 import**：
```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
```

**修改 constructor**：增加 `address _token` 参数，存为 `IERC20 public immutable token`：
```solidity
constructor(uint64 _declaredTotal, uint64 _recipientCount, address _auditor, address _token)
```

**新增状态变量**：
```solidity
IERC20 public immutable token;
mapping(address => bytes32) public pendingClaimHandle; // claim 后存的 allocation 密文 handle
mapping(address => bool) public transferred;            // 是否已完成 token 转账
```

**新增错误**：
```solidity
error NotClaimed();
error AlreadyTransferred();
error AmountMismatch();  // 链下解密结果与提交的 amount 不一致时
```

**修改 `claim()`**：在原逻辑（claimed[msg.sender]=true → FHE.add(claimedTotal) → emit Claimed）基础上：
1. 把 `_allocation[msg.sender]` 标记为公开可解密：调用 `FHE.makePubliclyDecryptable(_allocation[msg.sender])`，并把返回的 euint64 写回 `_allocation[msg.sender]`
2. 存储 handle：`pendingClaimHandle[msg.sender] = bytes32(euint64.unwrap(_allocation[msg.sender]))`
3. 发出新事件 `ClaimRequested(address indexed user, bytes32 handle)`，让链下 oracle 监听

**新增 `executeTransfer(address user, uint64 amount)`**：
```solidity
/**
 * @notice 链下 oracle 公开解密 pendingClaimHandle[user] 后调用此函数完成转账。
 *         MVP 阶段：任何人可调用（信任链下 publicDecrypt 的诚实性）。
 *         生产环境：应验证 KMS 签名 + amount 与 handle 解密结果一致。
 */
function executeTransfer(address user, uint64 amount) external {
    if (!claimed[user]) revert NotClaimed();
    if (transferred[user]) revert AlreadyTransferred();
    transferred[user] = true;
    require(token.transfer(user, amount), "token transfer failed");
    emit TokenTransferred(user, amount);
}
```

**新增事件**：
```solidity
event ClaimRequested(address indexed user, bytes32 handle);
event TokenTransferred(address indexed user, uint64 amount);
```

### 2. 编译通过
`npx hardhat compile` 必须成功（**注意**：现有测试会因 constructor 签名变化而失败，这是预期，由 Task E 修复）

## 不可越界
- ❌ 不要修改 `test/` 下任何文件（即使现有测试会因此失败也不要改，由 Task E 处理）
- ❌ 不要新建 MockToken.sol（这是 Task A 的工作）
- ❌ 不要修改 `hardhat.config.ts`
- ❌ 不要 commit（主线程统一 commit）
- ❌ 不要在 `claim()` 里直接转账（必须分两步：claim 标记 + executeTransfer 实际转）

## 设计原因记录
为什么 claim 要 makePubliclyDecryptable？因为 token 转账需要明文 amount。这意味着用户主动 claim 即授权暴露自己的金额——这是可接受的隐私权衡（不 claim 则继续保密）。

## 完成回报
- 修改了哪些函数 / 新增了哪些函数
- 编译输出
- 提示主线程：现有 18 个测试会失败（因 constructor 签名变化），需要 Task E 修复
