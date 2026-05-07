> ⚠️ **Superseded by V7.** This V6 4-tab role/page protocol is **historical reference only**.
> Current authoritative behavior is defined by the V7 OpenSpec change at
> `openspec/changes/v7-dapp-wizard/specs/*/spec.md` until V7 is archived into `openspec/specs/`.
> Do not use this document to make implementation decisions for V7.
>
> **Note on "executor" sections below**: V7 eliminated the off-chain
> `scripts/executor.ts` daemon — the frontend wallet that triggers each flow
> now self-submits the KMS callback via [`frontend/src/lib/kms-active-pull.ts`](../frontend/src/lib/kms-active-pull.ts).
> See [ADR 0003](./ADR/0003-frontend-as-primary-executor.md). Any "executor"
> reference below describes the V6 model, not V7+ behaviour.

# Role / Page Protocol

更新日期：2026-05-06

> **当前实现**：本协议在前端落地为 V6 IA —— 4 个 tab 始终可见，角色门槛通过 `· active` / `· preview` 后缀标注，Overview tab 顶部还有 `CapabilityStrip` 概览。代码入口：[`frontend/src/pages/CampaignLayout.tsx`](../frontend/src/pages/CampaignLayout.tsx) + [`frontend/src/components/CapabilityStrip.tsx`](../frontend/src/components/CapabilityStrip.tsx)。
>
> 历史背景：曾经讨论过 5 个变体（V1–V5），最终由 Codex 独立 review 推翻最初的 V3「自动重定向到首个角色 tab」方案，提出 V6 并获采用。原因：自动重定向破坏 URL 稳定性，且阻断多角色钱包同时演示多个能力的路径。

## 1. 目标

把 ZamaDrop 的“角色”、“页面”、“系统执行职责”拆开，避免把用户交互和链下执行流程混在一起。

这份文档回答 3 个问题：

1. 谁在系统里扮演什么角色
2. 页面应该按什么边界来设计
3. 前后端调用协议应该如何分层

## 2. 角色模型

当前产品需要区分 5 类能力，不是 4 类：

- `Public`
- `Admin`
- `Recipient`
- `Auditor`
- `Executor / System`

其中前 4 个是用户视角，最后 1 个是系统视角。

### 2.1 Public

- 不需要连接钱包
- 可查看公开 campaign 信息
- 看不到任何个人 allocation 金额

### 2.2 Admin

- 设置 recipient allocation
- 发起 `finalize()`

### 2.3 Recipient

- 解密自己的 allocation
- 发起 `claim()`

### 2.4 Auditor

- 解密聚合值 `claimedTotal`
- 不能解密任何个人 allocation

### 2.5 Executor / System

- 监听 `FinalizeRequested(handle)` / `ClaimRequested(user, handle)` 事件
- 通过 Zama Gateway 调 `publicDecrypt([handle])`，拿到明文 + KMS threshold 签名 (`decryptionProof`)
- 调用 `callbackFinalize(bool, bytes decryptionProof)` / `executeTransfer(address, uint64, bytes decryptionProof)`

结论：
`callbackFinalize` 和 `executeTransfer` 不属于用户角色，而属于系统执行层；前端不暴露这两个写操作的 UI 控件。当前实现：[`scripts/executor.ts`](../scripts/executor.ts) 守护进程，每 8 秒轮询一次。**信任根是合约里的 `FHE.checkSignatures` 校验，不是 executor 进程的身份**——任何账户都可以跑这个脚本，多实例并发也安全。

## 3. 多角色原则

一个地址可以同时拥有多个角色。

典型例子：

- 同时是 `Admin` + `Auditor`
- 同时是 `Recipient` + `Auditor`
- 同时是 `Admin` + `Recipient`

因此页面设计不能基于“一个人只对应一个 tab”的假设，而应基于“一个钱包当前拥有哪些能力”。

V6 落地的原则：

- **Tab 表示"能力视图"，不是"互斥身份"**：4 个 tab (`Overview` / `Admin` / `Recipient` / `Auditor`) 在所有状态下都可见，包括未连接钱包时
- **角色门槛通过后缀显示**：role-gated tab label 后挂 `· active` 或 `· preview`；Overview 是 universal tab，没有后缀
- **不自动重定向**：连接钱包不会跳转到"首个匹配的角色 tab"——曾在 V3 设计里尝试过，被拒绝（原因见文档顶部）
- **顶部 badge 显示当前能力组合**：`CampaignLayout` header 的 `You · Admin / Auditor` badge（仅在持有至少一个角色时渲染）
- **Overview 上有 CapabilityStrip**：3 个 chip（Admin / Recipient / Auditor），每个都标 active 或 preview 并直链对应 tab，让刚连上钱包的访客无需 point-and-test 就能看清自己持有哪些能力
- **写操作和敏感动作按链上角色 guard**：见 §4 各 tab 的 Preview 模式描述

## 4. 页面模型（V6 落地版）

实际路由：

- `/` → `PublicHome` （所有 campaign 的列表）
- `/campaign/:address` → Overview（universal）
- `/campaign/:address/admin` → Admin tab
- `/campaign/:address/me` → Recipient tab
- `/campaign/:address/audit` → Auditor tab

`Executor / System` 不暴露成 UI 页，而是 [`scripts/executor.ts`](../scripts/executor.ts) 守护进程。

### 4.1 Overview Tab（universal · 无角色门槛）

职责：

- 展示公开 campaign 信息（`CampaignCard`）
- 顶部显示 `CapabilityStrip`：3 个 chip 标识当前钱包持有的能力，每个 chip 直链到对应 tab
- 不要求钱包连接

实现位置：

- [`frontend/src/pages/CampaignOverview.tsx`](../frontend/src/pages/CampaignOverview.tsx)
- [`frontend/src/components/CampaignCard.tsx`](../frontend/src/components/CampaignCard.tsx) — `CampaignCard` 渲染 3 状态相位（`Setup` / `Finalize-pending` / `Claiming`）
- [`frontend/src/components/CapabilityStrip.tsx`](../frontend/src/components/CapabilityStrip.tsx)

数据来源：通过 [`useCampaignReads`](../frontend/src/hooks/useCampaignReads.ts) 一次 multicall 拿 `admin / auditor / declaredTotal / recipientCount / finalized / token / finalizeCheckHandle`。

### 4.2 Admin Tab

职责：

- 展示 campaign setup 状态 + 已配置 allocation 流水（`AllocationLedger`）
- 执行 `setAllocation()`、`finalize()`

不应承担的职责：

- 不应把 `publicDecrypt(finalizeCheckHandle)` 与 `callbackFinalize()` 作为 Admin 的业务责任——结算由 [`scripts/executor.ts`](../scripts/executor.ts) 自动跑

V6 交互：

- **未连接（Preview mode · not connected）**：仅渲染 guard alert "Connect a wallet to see whether you can act here. Until then this is a read-only walkthrough of the admin workflow."；操作面板（StatusCard / SetAllocationForm / AllocationLedger / FinalizePanel）**不渲染**——非 admin 不应看 admin 操作工作面
- **已连接但非 admin（Preview mode · not the admin）**：同上，仅 guard alert "This wallet can inspect the admin workflow but cannot submit transactions. Only the campaign admin can set allocations or finalize."；操作面板**不渲染**
- **已连接且是 admin**：渲染整套面板，开放写操作；StatusCard 显示当前 phase
- **finalize 后**：`FinalizePanel` 切到 "waiting for executor to settle finalization"

实现位置：[`frontend/src/pages/admin/AdminPage.tsx`](../frontend/src/pages/admin/AdminPage.tsx) + `SetAllocationForm.tsx` + `AllocationLedger.tsx` + `FinalizePanel.tsx`。

### 4.3 Recipient Tab

职责：

- 查看是否具备 allocation
- 解密自己的 allocation（user re-encryption）
- 执行 `claim()`

不应承担的职责：

- 不应把 `publicDecrypt(pendingClaimHandle)` 与 `executeTransfer()` 作为 Recipient 的业务责任——结算由 executor 自动跑

V6 交互：

- **未连接**：渲染 info alert "Connect your wallet"
- **已连接但 `allocationSet[addr]=false`（Preview mode · no allocation）**：仅渲染 muted alert "This wallet (...) is not registered for this campaign. Ask the admin to add you, then reload."；AllocationCard / ClaimStepper / BalancePanel **均不渲染**——非 recipient 没有要看的 operational 数据，wallet 自己的 token balance 在 Overview tab 看
- **已连接且有 allocation**：开放 `AllocationCard` 的 decrypt + `ClaimStepper` 的 3 步骤
- `ClaimStepper` 的 step3 区分 `idle / current / done` 三态：transferred=true 时 step3 显示绿色 ✓；step2 的 title/description 也根据状态切换文案
- `AllocationCard` 在 transferred=true 时 footnote 加上 "amount is now public via ERC-20 Transfer event; re-decrypting confirms ACL access"

实现位置：[`frontend/src/pages/recipient/RecipientPage.tsx`](../frontend/src/pages/recipient/RecipientPage.tsx) + `AllocationCard.tsx` + `ClaimStepper.tsx` + `BalancePanel.tsx`。

### 4.4 Auditor Tab

职责：

- 请求并解密 `claimedTotal`（仅 auditor）
- 展示合规边界说明（**所有访客可见**——这就是 ZamaDrop 的卖点）
- 展示 claim 活动流水

V6 交互（3 状态）：

- **未连接（Preview mode · not connected）**：渲染 guard alert + `ComplianceCard`（合规故事）；**不**渲染 `AggregateCard`（合约 view `requestClaimedTotalForAuditor` 对非 auditor revert）和 `ClaimsActivity`（claim 活动列表是 auditor 工作面，非 auditor 不展示）
- **已连接但非 auditor（Preview mode · not the auditor）**：同上，guard alert 文案 "This wallet does not hold the auditor role for this campaign. You can inspect the auditor workflow but cannot decrypt the aggregate."
- **已连接且是 auditor**：渲染 `AggregateCard` + `ComplianceCard` + `ClaimsActivity`，开放 decrypt aggregate

> 关键点：`ComplianceCard`（"auditor 看得到聚合、看不到个人"那张紫色解释卡）**必须对所有访客可见**——它本身就是 ZamaDrop 的 selling point，藏在 auditor guard 后面会破坏产品叙事。其他角色面板（`AggregateCard` / `ClaimsActivity`）属于 auditor 工作面，非 auditor 不展示。

实现位置：[`frontend/src/pages/auditor/AuditorPage.tsx`](../frontend/src/pages/auditor/AuditorPage.tsx) + `AggregateCard.tsx` + `ComplianceCard.tsx` + `ClaimsActivity.tsx`。

#### 4.4.1 已知坑

`AggregateCard` 调 `requestClaimedTotalForAuditor()` 这个 view 函数时 *必须* 传 `account: walletAddress`，否则 wagmi 默认用 `from: 0x0` 调用，合约的 `msg.sender == auditor` 校验会 revert，看起来"读不到 handle"，导致 Decrypt 按钮永远 disabled。同样的坑也存在于其他依赖 `msg.sender` 的 view 函数。

## 5. 历史边界问题 · 收敛状态

### 5.1 系统执行职责被塞进用户页 ✅ 已解决

历史问题：早期 `AdminTab` / `RecipientTab` 同时承担了 `callbackFinalize` / `executeTransfer`。

现在：前端不再触发任何 callback / executeTransfer。Admin 只调 `finalize()`，Recipient 只调 `claim()`，剩下的由 [`scripts/executor.ts`](../scripts/executor.ts) 守护进程通过 KMS 公开解密自动结算。Admin / Recipient 页只显示 "waiting for executor to settle" 的状态文案。

### 5.2 前端配置 demo 硬编码 ✅ 已解决

现在：`frontend/.env.example` 暴露 `VITE_CAMPAIGN_ADDRESS` / `VITE_TOKEN_ADDRESS`，`frontend/src/config.ts` 在 env 缺省时回退到 `deployments/sepolia.json` 的当前部署。

`admin` / `auditor` 完全走链上 getter（[`useCampaignReads`](../frontend/src/hooks/useCampaignReads.ts)），不再依赖本地常量。

### 5.3 角色判断基于链上能力 ✅ 已解决

实现：[`frontend/src/useRoleInfo.ts`](../frontend/src/useRoleInfo.ts) 是唯一真值来源，输入是钱包地址 + campaign 地址，输出 `{ isAdmin, isRecipient, isAuditor, roleLabels }`，对应链上 `admin()` / `allocationSet(addr)` / `auditor()`。`CampaignLayout` 与 `CapabilityStrip` 共用同一份 hook，保证 tab 后缀和 chip 状态完全一致。

### 5.4 已知 footgun（V6 仍需注意）

- 调用任何依赖 `msg.sender` 校验的 view 函数（例如 `requestClaimedTotalForAuditor`），wagmi 必须显式传 `account` 参数（见 §4.4.1）
- viem `getLogs` 在 Sepolia 公共 RPC 上有 50k block 范围上限，[`useCampaignEvents`](../frontend/src/hooks/useCampaignEvents.ts) 的 `fromBlock` 默认取 `latest - 49000n`；同样的修正也在 `scripts/executor.ts` 与 `scripts/verify-roles.ts` 里

## 6. 前后端调用协议

推荐明确拆成 4 层：

### 6.1 Public Read Layer

职责：

- 所有公开只读状态
- 无钱包也能读

接口：

- wagmi `useReadContract`

### 6.2 User Action Layer

职责：

- 用户主动发起的写操作
- 例如 `setAllocation()` / `finalize()` / `claim()`

接口：

- wagmi `useWriteContract`

### 6.3 FHE Client Layer

职责：

- 浏览器端加密
- user re-encryption 解密
- public decrypt

接口：

- `frontend/src/fhevm.ts`

### 6.4 Executor Layer

职责：

- 消费公开可解密 handle
- 将结果回写链上

接口：

- `callbackFinalize(bool)`
- `executeTransfer(address,uint64)`

实现形式：

- 初期优先脚本
- 后续可做内部面板或服务

## 7. 并行开发边界

为了后续开多个 sub-agent，建议按下面边界拆：

- `A. Deployment / env contract`
- `B. Public + role read model`
- `C. Admin flow`
- `D. Recipient flow`
- `E. Auditor flow`
- `F. Executor / settlement flow`
- `G. Fresh-state E2E prep`

每个模块都尽量只拥有自己的状态机和协议，不跨层偷拿职责。

## 8. 当前阶段的结论

V6 + KMS 加固 + executor 守护进程之后，4 条边界已经收敛清楚：

- 用户角色（Admin / Recipient / Auditor）在 UI 层
- 系统执行（Executor）在守护进程层，无 UI
- 信任根在合约层 `FHE.checkSignatures`，不在任何账户身份
- 多角色组合靠 capability tab + CapabilityStrip 自然展示，无需在 UI 层做角色互斥

下一阶段的进化方向不再是"沿现有边界继续收敛"，而是把这套抽象推广到多 campaign：landing 页 + factory 部署 + 多 campaign 列表选择。
