# 测试补齐方案

## 目标

补齐 ZamaDropCampaign 合约的回归测试，覆盖 Admin 从外部情报源读取金额并设置 allocation 的完整流程。

## 现状

现有 26 个测试用例（435 行），覆盖：
- 部署初始状态
- setAllocation: 4 个
- finalize: 4 个
- requestMyAllocation: 3 个
- claim: 5 个
- requestClaimedTotalForAuditor: 2 个
- token integration: 8 个（含 KMS 防伪造）

## 新增场景

### 1. 批量设置 allocation（高频）

```typescript
it("Admin 批量设置多个 allocation，runningTotal 应正确累加", async function () {
  // 为 10 个 recipient 设置 allocations，总和 = declaredTotal
  const recipients = [];
  const amounts = [100n, 200n, 150n, 50n, 100n, 100n, 100n, 50n, 100n, 50n]; // 总和 1000
  for (let i = 0; i < 10; i++) {
    const signer = await ethers.getSigners()[i];
    recipients.push(signer.address);
    const { handle, proof } = await encryptAmount(contractAddress, admin.address, amounts[i]);
    await contract.connect(admin).setAllocation(signer.address, handle, proof);
  }

  // finalize 应成功
  await contract.connect(admin).finalize();
  const handle = await contract.finalizeCheckHandle();
  const { ebool: result } = await publicDecryptWithProof(handle);
  expect(result).to.equal(true);
});
```

**复用**：`encryptAmount` helper，现有的 `publicDecryptWithProof` helper

**验证点**：
- `allocationSet[addr] === true` 对每个 recipient
- `runningTotal` 累加正确
- finalize 成功（总量匹配）

---

### 2. 设置后查询验证

```typescript
it("设置 allocation 后可通过 requestMyAllocation 查询 handle", async function () {
  const { handle, proof } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
  await contract.connect(admin).setAllocation(recipient1.address, handle, proof);

  const storedHandle = await contract.connect(recipient1).requestMyAllocation();
  expect(storedHandle).to.equal(handle);
});
```

**复用**：直接调用现有函数

**验证点**：
- 返回的 handle 与设置的 handle 一致

---

### 3. 权限边界：非受益人调用

```typescript
it("非受益人调用 requestMyAllocation 应 revert", async function () {
  const { handle, proof } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
  await contract.connect(admin).setAllocation(recipient1.address, handle, proof);

  // other 没有 allocation，调用会 revert
  await expect(
    contract.connect(other).requestMyAllocation()
  ).to.be.revertedWithCustomError(contract, "NoAllocation");
});
```

**复用**：现有 error 类型

---

### 4. 零值与边界金额

```typescript
it("设置为 0 应成功", async function () {
  const { handle, proof } = await encryptAmount(contractAddress, admin.address, 0n);
  await expect(
    contract.connect(admin).setAllocation(recipient1.address, handle, proof)
  ).to.not.be.reverted;
});

it("设置为 declaredTotal（单一受益人）应成功", async function () {
  const { handle, proof } = await encryptAmount(contractAddress, admin.address, DECLARED_TOTAL);
  await expect(
    contract.connect(admin).setAllocation(recipient1.address, handle, proof)
  ).to.not.be.reverted;
});
```

**验证点**：FHE 支持零值和边界

---

### 5. recipientCount 校验

```typescript
it("设置超过 recipientCount 的分配数（未 finalize）应仍可工作", async function () {
  // 不检查 recipientCount，只在总量验证时检查
  // 这个测试验证合约不做提前校验
});

it("设置了部分 allocation 就 finalize（总量不足）应失败", async function () {
  const { handle, proof } = await encryptAmount(contractAddress, admin.address, 100n);
  await contract.connect(admin).setAllocation(recipient1.address, handle, proof);

  await contract.connect(admin).finalize();
  const handle = await contract.finalizeCheckHandle();
  const { ebool: result } = await publicDecryptWithProof(handle);

  // result 应为 false（总量 100 != declaredTotal 1000）
  expect(result).to.equal(false);
});
```

**复用**：现有的 finalize 逻辑

---

### 6. 中间状态读取

```typescript
it("finalize 前 claimedTotal handle 应为 0", async function () {
  const handle = await contract.connect(auditor).requestClaimedTotalForAuditor();
  const zeroHandle = "0x0000000000000000000000000000000000000000000000000000000000000000";
  // 验证 handle 是零值
});

it("finalize 前 transferred 标志应为 false", async function () {
  expect(await contract.transferred(recipient1.address)).to.equal(false);
});
```

**新增验证点**：中间状态的只读字段

---

## 执行计划

1. **新增文件**：`test/ZamaDropCampaign.extended.test.ts`
2. **复用 helpers**：从原 test 文件 import `encryptAmount`, `publicDecryptWithProof`
3. **执行验证**：`npm test`
4. **覆盖率检查**：`npm run coverage`

## 预期结果

- 现有 26 个用例保持通过
- 新增 10+ 个用例覆盖边界和批量场景
- 覆盖率提升至 >90%

---

## Wallet E2E Strategy (merged from docs/metamask-automation-plan.md, 2026-05-07)

ZamaDrop 的真钱包浏览器验收，推荐采用：

- **主方案**：`Playwright + Synpress`
- **备用方案**：`Playwright + dAppwright`

不建议继续只靠通用页面自动化工具来做 MetaMask 验收。原因很简单：ZamaDrop 的关键路径包含浏览器扩展弹窗、EIP-712 签名、切链确认、交易确认；这些步骤不在 dApp 主页面 DOM 里，普通页面工具控制不到，或者极不稳定。

### 1. 为什么选 Synpress

#### 1.1 能力匹配

Synpress 直接提供 MetaMask 专用能力，覆盖 ZamaDrop 需要的关键动作：

- 连接 dApp：`connectToDapp()`
- 确认签名：`confirmSignature()`
- 拒绝签名：`rejectSignature()`
- 确认交易：`confirmTransaction()`
- 等待交易落链：`confirmTransactionAndWaitForMining()`
- 批准切链：`approveSwitchNetwork()`

当前实现约定：

- 连接流程本质上仍然由 dApp 发起真实 provider 请求，MetaMask 弹出真实授权 UI
- `MM1` 专门覆盖 `Connect MetaMask`，验证连接、地址、角色标签
- `MM2/MM3/MM4` 不重复测试连接，把钱包缓存初始化为已连接 session，然后直接验签名和业务状态
- Synpress 官方 `connectToDapp()` 是首选；但 Synpress `4.1.2` 与 MetaMask `13.13.1` 当前授权页 selector 不匹配，本项目临时用 `frontend/e2e/utils/connectToDapp.ts` 只负责点击真实弹窗里的 `Next/Connect/Confirm`
- MetaMask `13.13.1` onboarding completion 在 Chromium 中会优先走 Side Panel；`frontend/e2e/wallet-setup/completeOnboarding.ts` 只作为测试兼容层，让钱包缓存进入可处理 dApp 请求的 home/unlocked 状态

#### 1.2 适合当前项目

ZamaDrop 当前前端特征：

- Vite + React 19
- `wagmi` v3
- `injected()` connector
- dApp 运行在 `frontend/`
- 真实流程依赖 MetaMask + Sepolia + Zama KMS

Synpress 的 Playwright 集成最适合做下面这类真实验收：

1. 点击 `Connect MetaMask`
2. 自动批准连接
3. 识别 Admin / Recipient / Auditor 角色 UI
4. 发起 EIP-712 解密签名
5. 自动批准签名
6. 在允许的前提下自动确认链上交易

#### 1.3 为什么不是 dAppwright

dAppwright 也可行，且上手不难；但当前主流资料、API 完整度、MetaMask 专用方法覆盖面，Synpress 更适合作为默认方案。dAppwright 保留为 fallback：

- 如果 Synpress 与当前 MetaMask 版本不兼容，可切换
- 如果只想快速做 `connect + approve` 的 PoC，dAppwright 也能完成

### 2. 现实边界

即使采用 Synpress，也不要把所有测试都放进真钱包 E2E。

#### 2.1 应该自动化的

- Connect Wallet
- 角色识别
- 错链 banner
- Recipient 解密流程的签名弹窗与结果渲染
- Auditor 解密流程的签名弹窗与结果渲染
- 条件满足时的 claim / executeTransfer

#### 2.2 不应该全部走真钱包的

- 首屏渲染
- Public 只读 stats
- 未连接钱包时的空态与 guard
- wasm 懒加载检查
- console / network 清洁度

这些仍然应由普通 Playwright 或现有浏览器检查工具承担。真钱包 E2E 只跑少数高价值主线，否则：

- 慢
- 脆
- 依赖 Sepolia 出块与 KMS 响应
- 容易因 MetaMask UI 小改动而波动

### 3. 推荐测试分层

#### Layer A：无钱包自动化

目标：验证不连钱包时的 UI、懒加载、文案、网络请求、console。

继续沿用现有文档：

- `docs/test-plan.md`
- `docs/qa-walkthrough.md`
- `docs/qa-checklist.md`

#### Layer B：真钱包自动化

目标：验证最有价值的真实路径。

第一批只做 5 条：

1. `MM1` Connect MetaMask 成功，顶部角色标签正确
2. `MM2` Recipient 解密成功，出现 `600 ZDT`
3. `MM3` Auditor 解密成功，出现 `claimedTotal`
4. `MM4` 拒签后错误恢复，二次点击可重试
5. `MM5` 错链 banner 出现，批准切回 Sepolia

#### Layer C：条件性真钱包自动化

需要新部署或新 recipient 地址后再做：

1. `MM6` Claim 成功
2. `MM7` Execute transfer 成功
3. `MM8` Admin finalize 完整流程

当前 Sepolia 状态很可能已经 `Claiming`，而 deployer 已 claim 过，因此 `MM6-MM8` 不能作为第一批自动化 blocking 项。

### 4. 目录建议

建议新增：

```text
frontend/e2e/
  playwright.config.ts
  wallet-setup/
    basic.setup.ts
    connected.setup.ts
  fixtures/
    testWithMetaMask.ts
  specs/
    metamask-connect.spec.ts
    recipient-decrypt.spec.ts
    auditor-decrypt.spec.ts
    rejection-retry.spec.ts
    wrong-chain.spec.ts
```

### 5. 环境变量建议

新增一个专供前端 E2E 的环境文件，例如 `frontend/.env.e2e.example`：

```bash
E2E_BASE_URL=http://127.0.0.1:5173
E2E_WALLET_PASSWORD=changeme
E2E_WALLET_SEED=word1 word2 ... word12
E2E_ADMIN_ADDRESS=0xYourAdminWalletHere
E2E_AUDITOR_ADDRESS=0xYourAuditorWalletHere
E2E_RECIPIENT_ADDRESS=0xYourRecipientWalletHere
E2E_CHAIN_ID=11155111
```

说明：

- 不把真实 seed 写入 git
- 如果继续使用当前 deployer 账号，PoC 能先跑通 connect / decrypt / auditor
- 如果要自动化 claim，建议单独准备一个新 recipient 钱包和新 campaign

### 6. PoC 范围

第一轮 PoC 不追求"全自动全覆盖"，只追求跑通最关键的真实动作。

#### P0

1. 启动前端
2. MetaMask 自动导入测试钱包
3. 自动连接到 dApp
4. 验证页面顶部地址与角色标签

#### P1

1. 进入 Recipient tab
2. 点击 `Decrypt my amount`
3. 自动确认 EIP-712 签名
4. 等待 KMS 返回
5. 验证页面显示金额

#### P2

1. 进入 Auditor tab
2. 点击 `Decrypt aggregate`
3. 自动确认 EIP-712 签名
4. 验证页面显示 aggregate

#### P3

1. 拒签一次
2. 验证错误 UI
3. 再次点击并成功签名

### 7. 当前回归策略

真钱包回归分成两类：

1. `basic.setup.ts`：只用于 `MM1`。这个用例从未连接状态开始，覆盖一次完整 connect 授权。
2. `connected.setup.ts`：用于 `MM2/MM3/MM4`。缓存构建时已经完成连接，测试本身从已连接 session 开始，避免重复验证前置流程。

新增测试的默认规则：

- 如果目标是角色边界、解密、签名、claim、auditor 视图，使用 `testWithConnectedMetaMask`
- 如果目标是连接按钮、钱包授权、断开后重连，使用 `testWithMetaMask`
- 不要在每个测试里重复点击 `Connect MetaMask`，否则测试慢且脆

### 8. 关键实现注意事项

#### 8.1 不要使用 headless

钱包扩展弹窗在 headless 模式下不稳定。开发机上使用：

- `headless: false`

Linux CI 如后续接入，使用：

- `xvfb-run --auto-servernum`

#### 8.2 锁定 MetaMask / Synpress 版本

不要默认追最新版本。需要把这三个版本一起锁住：

- `playwright`
- `@synthetixio/synpress`
- MetaMask extension 版本

原因：MetaMask UI 变更经常导致 selector 或等待逻辑失效。

#### 8.3 先用 `127.0.0.1`

沿用 `docs/qa-walkthrough.md` 的约定，前端本地地址优先使用：

- `http://127.0.0.1:5173/`

不要先用 `localhost`，避免代理或 header 差异。

#### 8.4 先做连接与签名，不急着做 claim

ZamaDrop 当前最有风险的是：

- 钱包连接
- EIP-712 解密签名
- 错链与恢复

不是 claim 本身。claim 依赖链上状态，一旦 Sepolia 数据已消费，测试可重复性就差。

### 9. 最小测试清单

第一版正式纳入 CI 前，先要求本地稳定通过：

- `MM1` connect
- `MM2` recipient decrypt
- `MM3` auditor decrypt
- `MM4` reject then retry
- `MM5` wrong chain switch

只有这 5 条稳定后，才继续：

- `MM6` claim
- `MM7` execute transfer
- `MM8` finalize flow

### 10. 当前项目的明确下一步

建议按下面顺序推进：

1. 在 `frontend/` 引入 `Playwright + Synpress`
2. 先实现 `MM1` Connect MetaMask
3. 再实现 `MM2` Recipient 解密签名
4. 再实现 `MM3` Auditor 解密签名
5. 最后补 `MM4` 和 `MM5`

不要一开始就写 claim / finalize 自动化。

### 11. 存档说明

本方案是本次关于 MetaMask 自动化验收调研后的结论性文档。后续若实现落地，应补充：

- 依赖版本
- 目录结构最终路径
- 实际可运行命令
- 已知 flaky 场景
- 对应 commit SHA
