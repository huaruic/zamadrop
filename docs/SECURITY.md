# ZamaDrop · Security

更新日期：2026-05-06

> **TL;DR**
> ZamaDrop 的隐私边界是 *per-recipient + 直到 claim 的那一刻*；不是 "永远不可见"。
> 完整性边界由 **Zama threshold KMS 的密码学签名** 守护，不依赖任何调用者身份的诚实性。
> 旧版 MVP 合约里 `callbackFinalize` 和 `executeTransfer` 接受任何 caller / 任何明文参数 —— 这个 *production gap* 已经在当前部署里关闭：两个函数现在都通过 `FHE.checkSignatures` 在改写状态前校验 KMS threshold 签名（详见 §6）。本文档保留 §5.2 描述旧版 gap 的攻击向量，作为 *为什么需要 KMS 签名* 的教学材料。

---

## 1. Overview & Roles

ZamaDrop v0.x 是 "private allocations, public accountability" 模式的参考实现：每个 recipient 的金额作为 `euint64` 密文存储，campaign 总量在密文域通过 `FHE.eq` 验证。

| Role | Identity | Capability |
|---|---|---|
| **Admin** | `admin()` 存的钱包（构造时 `msg.sender`） | 调 `setAllocation`、`finalize`。无法解密任何个人 allocation 或 `claimedTotal` |
| **Recipient** | `allocationSet[addr] == true` 的钱包 | 调 `requestMyAllocation` 拿到自己金额的 re-encryptable handle，`finalized=true` 后调一次 `claim` |
| **Auditor** | `auditor()` 存的钱包（构造参数） | 调 `requestClaimedTotalForAuditor` 拿 `claimedTotal` handle 后用自己的 key re-encrypt。仅能看聚合 |
| **Public** | 任何读公开状态 / 事件的人 | 读 `declaredTotal` / `recipientCount` / `finalized` / `claimed[addr]` / `transferred[addr]` / `finalizeCheckHandle` / `pendingClaimHandle[addr]` 和所有 emitted events。不能解密任何 `euint64` |

**KMS callback 由谁提交（V7 起，参见 [ADR 0003](./ADR/0003-frontend-as-primary-executor.md)）**：触发流程的同一钱包用 relayer SDK `publicDecrypt` 主动拉取 KMS 签名 + 自己提交 callback。具体：finalize → admin 提交 `callbackFinalize`；claim → recipient 提交 `executeTransfer`。任何持有有效 Gateway 签名的账户都能合法提交（包括第三方救援工具 `scripts/recover-stuck-finalize.ts`）。完整性的信任根仍是 `FHE.checkSignatures` 校验的 KMS threshold 签名，**不是 caller 身份**。

---

## 2. Trust Model

### 2.1 Confidentiality（机密性）

| 数据 | 状态 |
|---|---|
| 未 claim 的 `_allocation[recipient]` | ✅ 永久加密。除非 KMS 被攻破，没有任何角色可解密 |
| 已 claim 的 recipient allocation | ❌ claim 那一刻起 *公开* —— ERC20 transfer event 公开 amount |
| `_runningTotal` (admin 配置过程中的累加) | ✅ 永久加密，从未被标记 publicly decryptable，也不在任何 ACL 里 |
| `_claimedTotal` (聚合 claim 总额) | ✅ 仅 auditor 在 ACL，仅 auditor 能 userDecrypt |
| `declaredTotal` / `recipientCount` / `admin` / `auditor` / `finalized` | 公开（设计如此） |

**关键事实**：claim 必然让 recipient 的 amount 变明文。这是 *普通 ERC20 兼容性* 的代价——ERC20.transfer 接受 `uint256` 明文 amount，链下也通过 Transfer event 索引。

要让 amount **永远** 加密，需要 ERC-7984 (Confidential ERC20) 替换底层 token，整个交易所 / 钱包 / DEX 生态需要重写。ZamaDrop 选择了 *边界明确的部分加密*：在 allocation 阶段加密，在 claim 转账阶段必然解密。

### 2.2 Integrity（完整性）

ZamaDrop 不依赖 admin / auditor / 任何调用者账户的诚实性来保证关键状态正确。所有真值由 **Zama threshold KMS** 签名背书：

- `finalize()` 计算 `eq(runningTotal, declared) → ebool`，链上只 emit handle
- KMS 通过 m-of-n threshold MPC 解密该 handle，签名后返回明文 + signature
- 合约的 `callbackFinalize` 通过 `FHE.checkSignatures([finalizeCheckHandle], abi.encode(result), decryptionProof)` 校验 KMS 签名后才翻 `finalized`
- 类似地 `executeTransfer` 通过 `FHE.checkSignatures([pendingClaimHandle[user]], abi.encode(amount), decryptionProof)` 校验 amount 与 handle 解密结果一致后才转账

---

## 3. Authorization Surface

### 3.1 `callbackFinalize(bool result, bytes decryptionProof)` — KMS-gated

**调用者身份**：任何 EOA。信任根是 KMS threshold 签名，不是 caller。

**链上检查**：合约在写 `finalized` 前调 `FHE.checkSignatures([finalizeCheckHandle], abi.encode(result), decryptionProof)`。传入伪造 bool —— 与 Zama Gateway threshold 解密的结果不一致 —— 没有有效签名，整笔交易 revert。

**为什么 permissionless caller 没问题**：KMS 签名校验后，调用者唯一能表达的"权力"是 *是否中继被签的结果*。他们无法伪造 bool、无法伪造签名、无法在合法签名存在后阻止链上效果。V7 默认是 admin 自己用 wizard / FinalizePanel 主动 pull + 提交（ADR 0003）；任何第三方持有有效 Gateway 签名也能合法提交，没人能颠覆结果。

**测试覆盖**：`test/ZamaDropCampaign.test.ts` 的 "KMS proof 校验下，任何账户都可提交 callbackFinalize" 测试 + 完整性 case。

### 3.2 `executeTransfer(address recipient, uint64 amount, bytes decryptionProof)` — KMS-gated

**调用者身份**：任何 EOA。

**链上检查**：合约在 ERC-20 转账前调 `FHE.checkSignatures([pendingClaimHandle[recipient]], abi.encode(amount), decryptionProof)`。传入与 Gateway 解密结果不一致的 `amount` 没有有效签名，revert。

**为什么 permissionless caller 没问题**：同 §3.1 形状。amount 通过密码学绑定到链上 handle，调用者只能原样中继被签的 `(handle, amount)` 对。他们不能用不同的 amount 抢跑、不能从一个 recipient 抢钱给另一个、不能掏空 escrow。Gas 抢跑无害。

**测试覆盖**：`test/ZamaDropCampaign.test.ts` 的 "amount 与 KMS 解密结果不一致时应 revert（防伪造）" case 端到端证明完整性保证。**26 个测试全过**。

### 3.3 Admin 和 Auditor 在 demo 部署里共用一个钱包

**含义**：当前 `deployments/sepolia.json` 里 `admin` 和 `auditor` 解析到同一个钱包地址。设置 allocation 的 key 同时 re-encrypt `claimedTotal`。

**为什么 v0.x 可以接受**：demo 用单一签名跑通端到端是为了让视频简洁，避免给多个钱包分发 testnet ETH。**个人** allocation 的隐私保证不受影响 —— `_allocation[recipient]` 仅通过 `FHE.allow` 授权给 `recipient`，admin / auditor 都不在 ACL 里。

**失败模式**：Auditor 独立性的强度等于运营商的 key 分离强度。如果 admin 和 auditor 是同一法律实体，auditor 的 "campaign 聚合" 证明不构成独立保证。

**测试覆盖**：合约测试用不同的 `admin` / `auditor` signer (`test/ZamaDropCampaign.test.ts:34`)，访问控制逻辑本身被覆盖。共用钱包是部署时选择，不是合约层声明。

### 3.4 KMS callback 由触发流程的钱包主动 pull 提交（V7 起）

**含义**：`finalize → Gateway publicDecrypt → callbackFinalize` 和 `claim → Gateway publicDecrypt → executeTransfer` 两条 callback 路径，V7 起由触发流程的同一钱包用 relayer SDK `publicDecrypt` 主动拉取 KMS 签名 + 自己提交 callback tx。具体：

| Callback | 由谁提交 | 何时 |
|---|---|---|
| `callbackFinalize` | Admin（finalize 同一钱包） | wizard Step 5.5 / AdminPage FinalizePanel |
| `executeTransfer` | Recipient（claim 同一钱包，自付 ~50k gas） | RecipientPage claim Step 2 |
| 应急救援 | 任何持有 Gateway 签名的账户 | `scripts/recover-stuck-finalize.ts` |

实现统一在 `frontend/src/lib/kms-active-pull.ts`（前端）和 `hre.fhevm.publicDecrypt`（CLI 脚本）。

**信任姿态**：caller 身份**不被信任** integrity。恶意 caller 因为 §3.1 / §3.2 的 KMS 签名校验，无法伪造 bool / amount。Caller 唯一能控制的是 *liveness* —— settlement 是否及时发生。

**失败模式**：Gateway 在 testnet 偶发 30+ 分钟无响应（实证 2026-05-07/08），active-pull 内置 3 次重试 + 5s backoff。如果 Gateway 真的不可用数小时，campaign 会留在 Finalizing 状态，资金锁死直到 V8 escape hatch（`openspec/changes/v8-finalize-recovery/`）落地。

**为什么不再有独立 Executor 服务**：见 [ADR 0003](./ADR/0003-frontend-as-primary-executor.md)。短答：deploy 触发 finalize 的 admin 钱包已经在线，就让它自己提交 callback 比维护一个常驻服务靠谱。

---

## 4. Decryption Pipeline · Plaintext Lifecycle

跟踪一次 recipient claim：

```
[1] 链上：_allocation[recipient] : euint64                    ← 密文
[2] recipient 调 claim()：FHE.makePubliclyDecryptable          ← 链上标记可解密
                          pendingClaimHandle[recipient] = h   ← handle 公开
                          emit ClaimRequested(recipient, h)
[3] 同一 recipient 浏览器：relayer SDK publicDecrypt([h])     ← 主动 pull,仍是 handle
[4] KMS Gateway：threshold MPC 解密 → 返回 (amount, sig)        ← 在 KMS 内部明文化
[5] Recipient 浏览器内存：amount + sig                         ← ⚠ plaintext 第一次出现
[6] Recipient 调 executeTransfer(recipient, amount, sig)       ← ⚠ 写进 calldata，永久公开
[7] 合约：FHE.checkSignatures(...)                             ← KMS 签名链上校验
        token.transfer(recipient, amount)                     ← ERC20 Transfer event 公开
```

**plaintext 第一次出现是 [5]**——Recipient 自己的浏览器内存。**[6][7] 之后明文已链上**。

Recipient 比"链上"早 **一笔 tx + 一个区块时间** 看到这个数 —— 而且看到的就是自己的 allocation（任何 recipient 都能用 `requestMyAllocation` + userDecrypt 在 claim 之前就看到自己的金额，所以 "[5] 早看到" 没有任何额外特权信息）。

---

## 5. Threat Analysis

### 5.1 恶意 KMS-callback caller 攻击面

V7 起由前端钱包主动提交 callback（ADR 0003），但合约依然不假设 caller 诚实。任何人持有有效 Gateway 签名都能合法提交。下面分析"恶意 caller"攻击面：

| 攻击 | 是否成功 | 原因 |
|---|---|---|
| 恶意 caller 解密未 claim 的 allocation | ❌ | 合约从未调 `makePubliclyDecryptable` 在那些 handle 上；KMS 拒绝解密 |
| 恶意 caller 解密别的 campaign 数据 | ❌ | 每个 handle 绑定具体 contract address，KMS 校验 |
| 恶意 caller 解密 `_runningTotal` | ❌ | 从未在 ACL 里、从未被标记 publicly decryptable |
| 恶意 caller 解密 `_claimedTotal` | ❌ | 仅 auditor 在 ACL |
| 抢先看到 *claim 后即将公开* 的 amount | ✅ 部分 | recipient 自己也能 userDecrypt 自己的 allocation；任何 caller 数秒后链上即公开。无额外特权信息 |
| 全局拒绝服务（Gateway 真的不可用） | ✅ | 缓解：active-pull 内置重试；V8 escape hatch 处理长时间死锁 |
| 伪造 amount 转账 | ❌ | KMS 签名 + `FHE.checkSignatures`，伪造金额 revert |
| 抢跑 callbackFinalize 翻 bool | ❌ | 同上 |

### 5.2 历史 MVP gap（教学材料）

> 当前合约已通过 §6 的 KMS 签名校验关闭了下面这两个 gap。本节保留作为
> *为什么这两个签名校验必不可少* 的教学说明；不再描述当前部署的行为。

旧版（v2 部署及之前）合约源码两处明文承认的 gap：

#### 5.2.1 `callbackFinalize(bool result)`

```solidity
// "在真实 Testnet 上，此函数应验证 KMS 签名；MVP 阶段接受任何调用者。"
function callbackFinalize(bool result) external {
    finalized = result;
    emit Finalized(result);
}
```

**攻击向量**：在 admin 调 `finalize()` *之前* 任何账户调 `callbackFinalize(true)` 翻 `finalized = true`。Recipient 立刻可 claim，绕过密文等式校验 —— admin 实际克扣了总额也没人知道。或反向投毒：admin 真的核对通过，攻击者抢调 `callbackFinalize(false)` 让 campaign 永久卡死。

#### 5.2.2 `executeTransfer(address user, uint64 amount)`

```solidity
// "MVP 阶段：任何人可调用（信任链下 publicDecrypt 的诚实性）。
//  生产环境：应验证 KMS 签名 + amount 与 handle 解密结果一致。"
function executeTransfer(address user, uint64 amount) external {
    if (!claimed[user]) revert NotClaimed();
    if (transferred[user]) revert AlreadyTransferred();
    transferred[user] = true;
    require(token.transfer(user, amount), ...);
}
```

**攻击向量**：recipient 真实 allocation 是 100，攻击者（包括 recipient 自己）调 `executeTransfer(recipient, 9999999)` —— 合约不校验 amount 与密文一致性，照转。`transferred[user] = true` 只能防双花，**不能防伪造金额**。

#### 5.2.3 关键观察

这两处 gap **和 callback 由 backend 服务还是 frontend 钱包提交无关**。哪怕完全不做 backend、让 recipient 自己在前端 publicDecrypt 然后自己调 callback —— 攻击向量依然存在。Caller 身份不是信任根；KMS 才是。这也是 V7 把 callback 提交移到 frontend 的前提（ADR 0003）—— 信任根不变。

---

## 6. Production Hardening · KMS Verification

### 6.1 合约改动（已 ship 在当前部署）

```solidity
// contracts/ZamaDropCampaign.sol
import { FHE } from "@fhevm/solidity/lib/FHE.sol";

contract ZamaDropCampaign is ZamaEthereumConfig {
    function callbackFinalize(bool result, bytes calldata decryptionProof) external {
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = finalizeCheckHandle;
        FHE.checkSignatures(handles, abi.encode(result), decryptionProof);
        finalized = result;
        emit Finalized(result);
    }

    function executeTransfer(address user, uint64 amount, bytes calldata decryptionProof) external {
        if (!claimed[user]) revert NotClaimed();
        if (transferred[user]) revert AlreadyTransferred();
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingClaimHandle[user];
        FHE.checkSignatures(handles, abi.encode(amount), decryptionProof);
        transferred[user] = true;
        require(token.transfer(user, amount), "token transfer failed");
        emit TokenTransferred(user, amount);
    }
}
```

### 6.2 升级后信任语义

- **Caller 不再是信任根** —— 任何人都可以提交 callback：recipient 自己、admin 自己、第三方机器人
- Caller 哪怕完全恶意，也无法伪造 amount / bool —— 合约会拒收
- V7 起 callback 由触发流程的钱包主动 pull + 提交（ADR 0003），CLI 救援工具 `scripts/recover-stuck-finalize.ts` 也走同一路径，签名校验是统一的

### 6.3 SDK 集成

```ts
// frontend / scripts 都用同一份
const result = await instance.publicDecrypt([handle]);
const amount = result.clearValues[handle];           // 明文
const proof = result.decryptionProof;                // KMS threshold 签名

// 透传给合约
await campaign.write.executeTransfer([user, amount, proof]);
```

---

## 7. Production Readiness Checklist

| 项 | 旧版 MVP (v2) | 当前 (v3, KMS-hardened) |
|---|---|---|
| `callbackFinalize` 校验 KMS sig | ❌ | ✅ |
| `executeTransfer` 校验 KMS sig + amount 一致 | ❌ | ✅ |
| Callback 提交方任意（admin / recipient / 第三方） | ✅ | ✅ |
| Caller 是信任根 | ⚠ MVP 信任 | ❌ KMS 是信任根（caller 无关）|
| Auditor 仅可解密聚合 `_claimedTotal` | ✅ | ✅ |
| Recipient 仅可 userDecrypt 自己的 allocation | ✅ | ✅ |
| 未 claim 的 allocation 永久加密 | ✅ | ✅ |
| `_runningTotal` 永久加密 | ✅ | ✅ |
| Frontend 不暴露 publicDecrypt / callback / executeTransfer 控件 | ✅ | ✅ |
| Threat model 文档化 | ✅ | ✅ |
| Hardhat 测试覆盖伪造金额 → revert | ❌ | ✅（"amount 与 KMS 解密结果不一致时应 revert（防伪造）"，26 tests pass） |

---

## 8. v1 Hardening Roadmap

按优先级。每项作用域是合约改动 + 对应的部署或链下变更。

### 8.1 Authenticate Gateway callbacks · ✅ Shipped

`callbackFinalize` 和 `executeTransfer` 都通过 `FHE.checkSignatures` 校验 Zama KMS threshold 签名后才改写状态。详见 §6 调用形状和 [`contracts/ZamaDropCampaign.sol`](../contracts/ZamaDropCampaign.sol) 实现。决策：**不**单独加 `kmsVerifier` 地址 —— FHE 库已经包了 verifier，直接暴露 `checkSignatures`，这是 Zama docs 推荐的路径。

### 8.2 引入显式 Caller 角色 · ✗ 故意不做

§8.1 落地后，显式 callback caller 角色不再必要：`executeTransfer` / `callbackFinalize` 调用者无法影响 amount / recipient / claim 状态，限制为某个 keeper 只是减少 liveness 冗余。V7 起前端钱包主动 pull + 提交（ADR 0003），任何持 Gateway 签名的 EOA 也能合法兜底 —— 多并行通过链上 `finalized` / `transferred[user]` map 幂等。CLI 救援路径见 [`scripts/recover-stuck-finalize.ts`](../scripts/recover-stuck-finalize.ts)。

### 8.3 分离 admin 和 auditor 钱包

- 更新 `deploy/01_deploy.ts` 接受 `ADMIN_ADDRESS` 和 `AUDITOR_ADDRESS` 作为独立环境变量，碰撞时拒绝部署除非传 `--allow-shared-roles`
- 更新 `deployments/sepolia.json` schema 记录两个钱包及其 key 持有人

### 8.4 可选 Merkle eligibility layer

- 通过在 `setAllocation` 或 `claim` 里要求 Merkle inclusion proof 恢复标准 "谁能 claim" guard。ZamaDrop 的 "多少" 隐私保留，因为 Merkle leaf 仅绑定 recipient 地址，不绑定金额
- 把 eligibility（公开 list）和 allocation（加密）解耦，是大多数 airdrop 的目标属性

### 8.5 Auditor multisig

- 多 stakeholder campaign 允许 `auditor` 是 Gnosis Safe (2-of-N) 而非 EOA。合约改动很小（`auditor` 已经是 `address`），但链下 re-encryption flow 需要支持 Safe 签名，relayer SDK v0.x 还没覆盖

---

## 8.5 setAllocationsBatch — 16 recipients per call is a protocol bound, not a config

`setAllocationsBatch(address[], externalEuint64[], bytes)` accepts batches of up to 16 recipients per transaction. This ceiling is **not a tunable knob** — it's the binding minimum of three protocol-layer constraints:

1. **FHEVM HCU per-tx budget** ← binding. The loop body's `FHE.add(_runningTotal, amount)` consumes Homomorphic Computation Unit depth tracked by `HCULimit.sol`. Empirically validated 2026-05-08: batch of 32 reverts `HCUTransactionDepthLimitExceeded()`; batch of 16 succeeds. The test in `test/ZamaDropCampaign.test.ts` ("batch of 16 happy path + gas budget sanity (HCU-bound, not SDK-bound)") pins this so a future loop change adding FHE ops catches a regression.
2. **Zama relayer SDK input-proof packing**: a single `createEncryptedInput` proof can hold ≤ 2048 bits of packed values. For uint64 amounts: `2048 / 64 = 32`. *Not* binding — HCU bites first.
3. **EVM block gas**: each `FHE.fromExternal` proof verify costs ~500k gas. A 16-recipient batch is ~8M gas (27% of Sepolia's 30M block limit). Plenty of margin; not binding.

The Solidity contract intentionally accepts arbitrary-length arrays without imposing a numeric cap — bumping the limit is a Zama-protocol upgrade (HCU budget raise or FHE op restructuring), not a project-internal change. Client tooling (frontend wizard, CLI scripts) chunks lists to ≤16 before submission.

For drops with N > 16 recipients, the wizard sends `⌈N / 16⌉` separate transactions. Even with smart-wallet bundling (deferred to a future iteration; see `openspec/changes/bulk-allocation/design.md §4.1`), the *transactions* remain physically separate because HCU is per-tx, not per-call — only the admin-side *signature count* drops to 1 in that future model.

---

## 9. Out of Scope

明确**不**在 ZamaDrop v0.x 范围，也不在 v1 roadmap 上的：

- **Anti-Sybil / KYC**：不在 ZamaDrop 范围。合约 *谁是 recipient* 由 admin 设置时决定，下游身份验证另行处理
- **Vesting / unlock curve**：MVP 只做即时 claim；vesting 留作未来扩展
- **多 campaign factory**：MVP 一份合约一个 campaign；多 campaign 留作未来扩展
- **后量子**：当前 FHE 方案 (TFHE) 在量子计算下的 long-term 安全性未单独评估
- **侧信道**：触发 callback 提交的浏览器/CLI 内存中短暂持有 plaintext（recipient 自己的 amount 或 finalize 的 sumCheck bool）。这只是 recipient 本身就能看到的信息，但 device 安全层面仍需注意（HTTPS / 不打 plaintext 到日志 / 关闭浏览器扩展的 DOM 读取权限）
- **跨链桥接**：confidential allocation 跨链传输不支持
- **Sanctioned address screening**：协议层不做。运营商需在 `setAllocation` 之前应用司法管辖控制

---

## 10. Disclosure Practice

如发现偏离 §3 假设的情况，或 §8 roadmap 未覆盖的漏洞，请：
- 在 GitHub issues 开 issue（替换为正式仓库 URL）
- 或邮件 maintainers（待定）

非 demo 部署上影响真实价值的问题强烈建议协调披露。

---

## 11. References

- [`docs/role-page-protocol.md`](./role-page-protocol.md) — 前端角色 / 页面 / 执行职责的清晰边界
- [`docs/prd.md`](./prd.md) — 产品定位与四角色职责
- [`contracts/ZamaDropCampaign.sol`](../contracts/ZamaDropCampaign.sol) — 当前实现
- [`test/ZamaDropCampaign.test.ts`](../test/ZamaDropCampaign.test.ts) — 26 个测试，含完整性 revert
- [`scripts/recover-stuck-finalize.ts`](../scripts/recover-stuck-finalize.ts) — CLI 救援工具示例（active-pull KMS callback）
- [`frontend/src/lib/kms-active-pull.ts`](../frontend/src/lib/kms-active-pull.ts) — 前端 active-pull 共享 util
- [`docs/ADR/0003-frontend-as-primary-executor.md`](./ADR/0003-frontend-as-primary-executor.md) — 决策记录
- Zama FHEVM docs — KMS verifier 接口、`makePubliclyDecryptable` 语义、`FHE.checkSignatures` 用法

---

## V7 Privacy Boundary

### What's Protected

- **Allocation-at-rest amount privacy** — `setAllocation` stores `euint64` ciphertext on-chain. Until claim, no one (including the deploying Admin, after deploy) sees individual amounts.
- **Settlement integrity** — `FHE.checkSignatures` ensures `executeTransfer(user, amount)` cannot be forged by any caller; KMS threshold signatures are verified on-chain in `callbackFinalize` and `executeTransfer`.
- **Aggregate privacy primitive** — Auditor decrypts `_claimedTotal` via Zama threshold KMS; individual amounts are never decrypted in the audit path.
- **Solvency invariant** — `balance >= declaredTotal - claimedTotalPlaintext` is publicly verifiable at any time. Any observer can read `balanceOf`, `declaredTotal`, and `claimedTotalPlaintext` from chain and confirm.

### What's NOT Protected

- **Recipient membership privacy** — `event AllocationSet(address indexed recipient)` makes the recipient list publicly enumerable via `eth_getLogs`. Anyone can query "is wallet X a recipient of campaign Y" or list all recipients.
- **Claim-time amount privacy** — `event TokenTransferred(address indexed user, uint64 amount)` and the underlying ERC-20 transfer broadcast the claimed amount in plaintext at claim time.
- **Indexer convenience layer** — Our `/api/me/campaigns` endpoint is gated by SIWE, but the underlying chain data is public. SIWE prevents API abuse, not membership disclosure.

### Trust Model

ZamaDrop uses Zama's threshold MPC KMS for FHE decryption. The KMS is currently operated by Zama and partners (the operator set may be permissioned in the live deployment). KMS signatures verified by `FHE.checkSignatures` provide settlement integrity but do not equal a fully-trustless cryptographic guarantee.

We use the term "threshold MPC parties" or "KMS nodes" rather than "validators" — KMS operators perform decryption, not consensus.

### V8+ Roadmap

The following protections are explicitly NOT in V7 and are tracked for V8+:

- **Membership privacy** via commitments / nullifiers / Merkle-style eligibility / stealth addresses (requires contract redesign + client-side ZK circuits + ceremony)
- **Real confidential token** (ERC-7984) once standardized on fhEVM, replacing the V7 plaintext settlement
- **pause / cancel / time-lock** controls for operational risk during long-lived campaigns
- **Batch setAllocation** for campaigns beyond ~50 recipients
- **Native Safe / EIP-4337 wallet support** beyond the basic EOA wizard path
