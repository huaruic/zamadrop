# Role / Page Protocol

更新日期：2026-05-03

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

- 消费 `finalizeCheckHandle`
- 调用 `callbackFinalize(bool)`
- 消费 `pendingClaimHandle`
- 调用 `executeTransfer(address,uint64)`

结论：
`callbackFinalize` 和 `executeTransfer` 虽然现在在前端页面里被触发，但它们本质上不属于用户角色，而属于系统执行层。

## 3. 多角色原则

一个地址可以同时拥有多个角色。

典型例子：

- 同时是 `Admin` + `Auditor`
- 同时是 `Recipient` + `Auditor`
- 同时是 `Admin` + `Recipient`

因此页面设计不能基于“一个人只对应一个 tab”的假设，而应基于“一个钱包当前拥有哪些能力”。

推荐原则：

- tab 表示“能力视图”，不是“互斥身份”
- 顶部显示多角色 badge，例如 `Admin · Auditor · Recipient`
- 每个 tab 都允许进入，但写操作和敏感动作按链上角色做 guard

## 4. 页面模型

推荐继续保留 4 个主页面：

- `Public`
- `Admin`
- `Recipient`
- `Auditor`

不把 `Executor / System` 暴露成普通用户页；优先实现为脚本、后台任务或内部调试面板。

### 4.1 Public Page

职责：

- 展示公开 campaign 信息
- 解释隐私模型
- 不要求钱包连接

数据来源：

- `declaredTotal()`
- `recipientCount()`
- `finalized()`
- `admin()`
- `auditor()`
- `token()`

### 4.2 Admin Page

职责：

- 展示 campaign setup 状态
- 执行 `setAllocation()`
- 执行 `finalize()`

不应承担的职责：

- 不应把 `publicDecrypt(finalizeCheckHandle)` 和 `callbackFinalize()` 作为 Admin 的业务责任

推荐交互：

- 未连接：可看状态预览，不能写
- 已连接但非 admin：显示 inline notice
- 已连接且是 admin：开放写操作
- `finalize()` 发起后：显示 “waiting for finalization settlement”

### 4.3 Recipient Page

职责：

- 查看是否具备 allocation
- 解密自己的 allocation
- 执行 `claim()`

不应承担的职责：

- 不应把 `publicDecrypt(pendingClaimHandle)` 和 `executeTransfer()` 作为 Recipient 的业务责任

推荐交互：

- 未连接：提示连接钱包
- 已连接但无 allocation：显示空状态
- 已连接且有 allocation：开放 decrypt / claim
- claim 后：显示 “waiting for transfer execution”

### 4.4 Auditor Page

职责：

- 请求并解密 `claimedTotal`
- 展示合规边界说明

推荐交互：

- 未连接：提示连接 auditor 钱包
- 已连接但非 auditor：显示 guard
- 已连接且是 auditor：开放 decrypt aggregate

## 5. 当前实现的主要边界问题

### 5.1 系统执行职责被塞进用户页

当前实现中：

- `AdminTab` 同时承担了 `finalize()` 和后续 callback
- `RecipientTab` 同时承担了 `claim()` 和后续 transfer 执行

这会导致：

- 用户职责和系统职责混在一起
- 页面状态机变复杂
- 测试难拆分
- 后续并行开发边界不清晰

### 5.2 前端配置仍偏 demo 化

当前 `frontend/src/config.ts` 里仍硬编码 campaign/token/address。

这会导致：

- fresh E2E state 难接入
- 页面角色与部署状态容易失真

推荐方向：

- 用 env 注入 `campaign` / `token`
- `admin` / `auditor` 优先走链上 getter，不依赖本地常量

### 5.3 角色判断应基于链上能力

前端角色来源应尽量统一为：

- `admin()` 判断 admin
- `auditor()` 判断 auditor
- `allocationSet(address)` 判断 recipient

tab 可以全量展示，但动作必须由链上能力决定。

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

当前问题不在于“缺少一个新的合约接口”，而在于：

- 缺少 `Executor / System` 这一层的独立边界
- 导致 Admin / Recipient 页面各自背了一半系统职责

后续如果要继续改页面和测试，应先沿着这条边界收敛，而不是继续在现有 tab 里叠更多逻辑。
