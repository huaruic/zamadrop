# Task E: 测试修复 + 扩展

## Goal
1. 修复现有 18 个测试（因 ZamaDropCampaign constructor 增加 token 参数而失败）
2. 新增 token 集成测试，覆盖 claim → executeTransfer 的完整流程

## 输入契约
- `contracts/MockToken.sol` 已存在
  - constructor: `(string name, string symbol, uint64 initialSupply, address admin)`
  - admin 自动获得 initialSupply
- `contracts/ZamaDropCampaign.sol` 新 constructor: `(uint64 _declaredTotal, uint64 _recipientCount, address _auditor, address _token)`
- 新增的 events：`ClaimRequested(address indexed user, bytes32 handle)`、`TokenTransferred(address indexed user, uint64 amount)`
- 新增的 errors：`NotClaimed`、`AlreadyTransferred`、`AmountMismatch`
- 新增的状态：`pendingClaimHandle[addr]`、`transferred[addr]`
- 新增的函数：`executeTransfer(address user, uint64 amount)`
- 现有测试位于 `test/ZamaDropCampaign.test.ts`，共 18 个，使用 `hre.fhevm.publicDecryptEbool/userDecryptEuint` 模式

## 输出契约

### 1. 修复现有测试（让它们重新全绿）
更新 `beforeEach`：
```typescript
beforeEach(async function () {
  [admin, recipient1, recipient2, auditor, other] = await ethers.getSigners();

  // 部署 MockToken（admin 持有 declaredTotal）
  const TokenFactory = await ethers.getContractFactory("MockToken");
  const token = await TokenFactory.connect(admin).deploy(
    "ZamaDrop Test Token",
    "ZDT",
    DECLARED_TOTAL,
    admin.address
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  // 部署 ZamaDropCampaign
  const Factory = await ethers.getContractFactory("ZamaDropCampaign");
  const deployed = await Factory.connect(admin).deploy(
    DECLARED_TOTAL,
    RECIPIENT_COUNT,
    auditor.address,
    tokenAddress  // 新增第 4 参
  );
  await deployed.waitForDeployment();
  contractAddress = await deployed.getAddress();
  contract = await ethers.getContractAt("ZamaDropCampaign", contractAddress);

  // 把 escrow 转入 campaign 合约（让 executeTransfer 时有钱可转）
  await token.connect(admin).transfer(contractAddress, DECLARED_TOTAL);
});
```

需要新增 `tokenContract` 变量供后续测试使用：
```typescript
let tokenContract: any;
// 在 beforeEach 里赋值给外层变量
tokenContract = token;
```

注意：`finalize 前 claim 应 revert` 这个测试里 `Factory.connect(admin).deploy(...)` 也要加 4 个参数。需要重新部署一个 fresh token + fresh campaign。

### 2. 新增 token 集成测试
在文件末尾新增 `describe("token integration", function () { ... })` 块：

测试用例：
1. **claim 应发出 ClaimRequested 事件并存储 pendingClaimHandle**
   - finalize 完成后，recipient1 调用 claim
   - expect emit ClaimRequested(recipient1.address, anyValue)
   - expect pendingClaimHandle[recipient1.address] != 0x00...

2. **executeTransfer 应成功转账并更新 transferred**
   - claim 完成后
   - 任何人（如 other）调用 `contract.executeTransfer(recipient1.address, ALLOC_1)`
   - expect transferred[recipient1.address] == true
   - expect token.balanceOf(recipient1.address) == ALLOC_1
   - expect emit TokenTransferred

3. **未 claim 时调用 executeTransfer 应 revert**
   - finalize 完成但 recipient2 未 claim
   - expect executeTransfer(recipient2, ALLOC_2) reverts with NotClaimed

4. **重复 executeTransfer 应 revert**
   - claim + executeTransfer 完成后
   - 再次 executeTransfer(recipient1, ALLOC_1)
   - expect reverts with AlreadyTransferred

5. **claim 后 pendingClaimHandle 可被 publicDecrypt 解密为正确 amount**
   - claim 完成后
   - 用 `hre.fhevm.publicDecryptEuint(FhevmType.euint64, pendingClaimHandle[user])` 解密
   - expect decrypted == ALLOC_1

### 3. 验证
```bash
npx hardhat compile
npx hardhat test
```
应：
- 现有 18 个测试全绿
- 新增 5 个测试全绿
- 总计 23 个测试通过

## 不可越界
- ❌ 不要修改 `contracts/`、`hardhat.config.ts`、`deploy/`
- ❌ 不要 commit
- ❌ 不要删除现有测试用例（可以更新 setup，但断言保持等价）

## 完成回报
- 测试结果（pass/fail 数量）
- 是否所有测试都用同一份 beforeEach
- 新增的测试列表
