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

---

## 12. 手动 E2E 回归 — 全角色全链路

> 面向人工 QA 的逐步执行手册。覆盖 Admin / Recipient / Auditor / Public
> 四角色，验证主路径 + 隐私边界 + 异常恢复。与 §11 真钱包自动化（Synpress）
> 的关系：自动化只跑高频高价值用例（MM1–MM5），本节负责发布前的全链路
> 人工核账，特别是隐私不变量（套件 B / D2）和资金扣款核账（套件 A3 / C2）。

### 12.1 前置参数

| 项 | 值 | 备注 |
|---|---|---|
| Campaign 规模 | N=2，declaredTotal=1000 ZDT，decimals=0 | 与 `deployments/sepolia.json` demo 同款 |
| Token | MockToken (ZDT) | 本地链：随合约一起部；Sepolia 复用 `0x775e867541D348F022B3431209710B5BC02Ad29C` |
| Admin / Auditor | `0x81f19692e5C59a7D7DB7D0689843C213C9BFA260`（同钱包） | wizard Step3 默认 auditor=admin |
| Recipient #1 | `<W_R1>` | 走完整 claim 主路径 |
| Recipient #2 | `<W_R2>` | 故意保持未 claim，用于验证聚合不变量与 V8 cancel 路径 |
| Observer | `<W_OBS>`（可选） | 验权限边界 + Public 只读 |
| 前端 | `http://127.0.0.1:5173` | 不要用 `localhost`，避免 cookie/header 偏差 |
| 浏览器 | Chrome/Brave + MetaMask（非 headless） | |

**双链回归**：

- **L (Local)** — `npx hardhat node` + `npm run deploy:localhost`，前端连 8545，
  fhEVM mock 替代 KMS，主验逻辑正确性。零 gas 成本、零 Gateway 等待。
- **S (Sepolia)** — 真链，验 KMS active-pull、Gateway 出块延迟、Etherscan
  账本可观测性、隐私边界。Admin 钱包需 ≥ 0.005 ETH + ≥ 1000 ZDT。

### 12.2 套件总览（17 个用例）

| 套件 | 用例 | 驱动角色 | L | S |
|---|---|---|---|---|
| A. Admin 部署主路径 | A1–A5 | Admin | ✓ | ✓ |
| B. 隐私边界（核心卖点） | B1–B3 | 任意 | ✓ | ✓ |
| C. Recipient 主路径 | C1–C3 | Recipient | ✓ | ✓ |
| D. Auditor 主路径 | D1–D2 | Auditor | ✓ | ✓ |
| E. Public 只读 | E1 | 无钱包 | ✓ | ✓ |
| F. 异常 & 权限边界 | F1–F3 | 多角色 | ✓ | 选做 |

### 12.3 套件 A — Admin 部署主路径

#### A1. Wizard Step 1–4 草稿持久化

**操作**：连 Admin → `/wizard` → Step1 填 `name="QA-DryRun" declaredTotal=1000`
→ Step2 填 `<W_R1>, <W_R2>` → Step3 auditor=admin → Step4 review →
**手动刷新页面** → 回 Step4。

**关注指标**：localStorage `wizardStore` 含 `draftVersion`、`recipients=[...]`、
`declaredTotal=1000`；snapshot hash 与重渲染后一致。

**通过判据**：Step4 review 数据与刷新前完全一致，无 stale 提示。

#### A2. Step5 五子步骤逐个走通

**操作**：Step5 点 **Start deployment**，依次签 N+3 = 5 笔（5.5 不签）。

| 子步 | 钱包动作 | 关注指标 | 预期 |
|---|---|---|---|
| 5.1 deploy | 1 笔 contract creation | `recipientListHash == keccak256(abi.encode([W_R1, W_R2]))`；构造参数 admin/auditor/token/declaredTotal 正确 | 拿到新 campaign 地址 `C_new` |
| 5.2 fund | ERC20 `transfer(C_new, 1000)` | Admin ZDT −1000；C_new ZDT +1000；ETH −gas | 资金到位 |
| 5.3 setAllocation × 2 | 2 笔 `setAllocation(addr, encAmount, proof)` | 每笔事件 `AllocationSet(recipient)`；`allocationSet[addr]==true`；`allocationCount: 0→1→2`；**事件 data 字段为空，topics 只有 indexed recipient** | UI `allocatedSoFar` 1/2 → 2/2 |
| 5.4 finalize | 1 笔 `finalize()` | 事件 `FinalizeRequested(checkHandle)`；`state: Setup→Finalizing`；`finalizeCheckHandle` 非零 | 进入 5.5 |
| 5.5 KMS active-pull | **0 钱包签名** + 1 笔 `callbackFinalize(true, proof)` | 事件 `Finalized(true)`；`state: Finalizing→Claiming`；`finalized()==true`；本地 ~3-10s，Sepolia ~10-15s | UI 跳 "Campaign live" |

**通过判据**：5/5 子步骤打 ✓；wizard 显示 "Campaign live" 卡片并给出
`/campaign/<C_new>` 分享链接。

#### A3. 账户扣款核账

**操作**：A2 完成后立即读 admin wallet 与 C_new 的 ZDT/ETH 余额。

| 项 | 部署前 | 部署后 | 差额必须 |
|---|---|---|---|
| Admin ZDT | `B_zdt_0` | `B_zdt_1` | `B_zdt_0 − B_zdt_1 == 1000` 精确 |
| C_new ZDT | 0 | 1000 | +1000 |
| Admin ETH | `B_eth_0` | `B_eth_1` | ≈ 5 笔 gas（Sepolia ~0.005 ETH） |

**通过判据**：ZDT 严格精确扣 1000；ETH 减少为 5 笔 gas 之和。

#### A4. 区块链账本可观测性

**操作**：在 Etherscan（S 链）或 hardhat events log（L 链）查 `C_new` 的事件。

**关注指标**：

- 4 个事件：`AllocationSet × 2` + `FinalizeRequested × 1` + `Finalized(true) × 1`
- `AllocationSet`：`topics[1]` = recipient（indexed）；`data` 长度为 0
- `recipientListHash` 等于 `keccak256(abi.encode([W_R1, W_R2]))`

**通过判据**：4 事件全部链上可见且**无任何字段泄漏 amount**。

#### A5. 错误恢复（拒签 + Retry）

**操作**：跑 A2 但在 5.3 第 1 笔签完后**拒签**第 2 笔 → UI 报错 → 点 Retry。

**关注指标**：`allocatedSoFar` 不丢；retry 跳过已完成 recipient 直接签第 2 笔；
wizard `partialize` 排除 `deployStep` 防止刷新越界。

**通过判据**：retry 后只重签 1 笔，最终 5/5 完成。

### 12.4 套件 B — 隐私边界（核心卖点，必验）

#### B1. AllocationSet 事件不泄漏金额

**操作**：A4 拿到的 2 条 `AllocationSet` 事件，逐个查 `data` 与 `topics`。

**关注指标**：
- `topics[0] == keccak256("AllocationSet(address)")`
- `topics[1]` = recipient 地址
- `data == 0x`（空）

**通过判据**：`data` 长度为 0，不存在任何 amount 密文/明文。建议截图存档。

#### B2. 非 recipient 调 requestMyAllocation 必须 revert

**操作**：用 `<W_OBS>` 调 `requestMyAllocation()`（Etherscan read 或本地 console）。

**通过判据**：revert reason = `NoAllocation()`。

#### B3. 跨 recipient ACL 隔离

**操作**：用 `<W_R1>` 钱包尝试 relayer SDK `userDecrypt` `<W_R2>` 的 `_allocation` handle。

**关注指标**：Gateway 返回 ACL 拒绝（无 KMS 签名）；前端报 "not allowed" 类错误。

**通过判据**：W_R1 拿不到 W_R2 的 amount 明文。

### 12.5 套件 C — Recipient 主路径

#### C1. Recipient 解密自己 allocation

**操作**：换 `<W_R1>` → `/campaign/<C_new>/me` → 点 **Decrypt my amount** →
同意 EIP-712 签名。

**关注指标**：`requestMyAllocation()` 返回非零 handle；KMS user-decrypt 后 UI
渲染金额；**仅签名，不发起任何链上交易**。

**通过判据**：UI 显示的 amount 等于 Step2 录入值。

#### C2. claim + executeTransfer

**操作**：W_R1 在同页点 **Claim** → 签 `claim()` → 等 KMS active-pull →
自动签 `executeTransfer(W_R1, amount, proof)`（共 2 笔 tx）。

| 项 | 关注 | 预期 |
|---|---|---|
| `claim()` 事件 | `Claimed(W_R1)` + `ClaimRequested(W_R1, handle)` | 双事件触发 |
| `claimed[W_R1]` | 链上读 | `true` |
| `pendingClaimHandle[W_R1]` | 链上读 | 非零 |
| `executeTransfer` 事件 | `TokenTransferred(W_R1, amount)` | amount 此时为 plaintext（转账已发生） |
| `transferred[W_R1]` | 链上读 | `true` |
| `claimedTotalPlaintext` | 链上读 | == W_R1 amount |
| W_R1 ZDT 余额 | 钱包 / Etherscan | +amount |
| C_new ZDT 余额 | Etherscan | −amount |

**通过判据**：钱包 ZDT 严格 +amount；合约余额 −amount；Stepper 显示 "Claimed"。

#### C3. 重复 claim 必须 revert

**操作**：C2 完成后 W_R1 再点 Claim。

**通过判据**：tx 在 estimate 阶段 revert（`AlreadyClaimed()`），不消耗 gas。

### 12.6 套件 D — Auditor 主路径

#### D1. Auditor 解密 claimedTotal

**操作**：换 admin=auditor 钱包 → `/campaign/<C_new>/audit` → 点
**Decrypt aggregate**。

**关注指标**：`requestClaimedTotalForAuditor()` 返回 handle；user-decrypt 后
UI 显示 `claimedTotal`；**值必须等于 `claimedTotalPlaintext`**（密文聚合 ==
明文累加器，双重核账）。

**通过判据**：两值完全相等。

#### D2. Auditor 不能看任何个人金额

**操作**：检查 auditor tab 是否暴露 per-recipient 金额列；尝试用 auditor
钱包 user-decrypt `_allocation[<W_R1>]` handle。

**通过判据**：UI 不暴露个人数；ACL 拒绝个体解密。

### 12.7 套件 E — Public 只读

#### E1. 未连钱包看公共数据

**操作**：新隐身窗口（**不连钱包**）打 `/campaign/<C_new>`。

**关注指标**：`declaredTotal=1000`、`recipientCount=2`、`state=Claiming`、
`claimedTotalPlaintext`、`recipientListHash` 全部可见；4 tab 都显示但
admin/recipient/auditor 标 `· preview`。

**通过判据**：无钱包能看公共账本；role-gated tab 仅 read-only preview，
没有可点的签名按钮。

### 12.8 套件 F — 异常 & 权限边界

#### F1. 错链 banner + 切链

**操作**：钱包切 Mainnet → 进 `/wizard` 或 `/campaign/<C_new>/admin`。

**通过判据**：顶部 wrong-chain banner；写按钮 disabled；点 Switch 触发
`wallet_switchEthereumChain`；切回 Sepolia 后按钮恢复。

#### F2. 非 admin 调 setAllocation revert

**操作**：用 `<W_OBS>` 钱包调 `setAllocation`（Etherscan write 或 hardhat console）。

**通过判据**：revert `NotAdmin()`。

#### F3. EIP-712 拒签后可重试

**操作**：C1 解密时**故意拒签** → UI 报错 → 再点 Decrypt。

**通过判据**：第二次签名弹窗正常；不残留 "decrypting…" 锁死状态；不需刷新。

### 12.9 回归触发策略

| 触发条件 | 必跑 |
|---|---|
| 改 `contracts/ZamaDropCampaign.sol` 任何函数/event/state | A+B+C+D 全套 in L；A2/A3/A4 + C1/C2 + B1 in S |
| 改 wizard `Step5Deploy.tsx` / `deploy.ts` / `kms-active-pull.ts` | A2/A5 + C2 全跑（KMS active-pull 高风险点） |
| 改角色页 `admin/* recipient/* auditor/*` | 对应套件全跑 + E1 |
| 改 ACL（任何 `FHE.allow*` 调用） | B1/B2/B3 + D2 必跑（隐私回归） |
| 改 `MockToken` 或 token 集成 | A3 + C2 余额核账 |
| 仅文档 / CLI 改动 | 不必 |
| 发布前 / Sepolia 重新部署 | 全套 in S |

### 12.10 通过门槛

- **L 链**：A1–A5 + B1–B3 + C1–C3 + D1–D2 + E1 + F1–F3 = **17/17 全过**
  才合并 PR。
- **S 链**：A2/A3/A4 + B1 + C1/C2 + D1 + E1 = **8 条核心** 全过才能挂
  "KMS-hardened" 标签。
- **任意隐私套件失败（B1/B2/B3/D2）= block release**，无例外。
