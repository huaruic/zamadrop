## MODIFIED Requirements

### Requirement: 部署中断续行(failed_partial)

如果 Step 5 任意子步骤(5.1 deploy / 5.2 fund / 5.3 setAllocation × N / 5.4 finalize / 5.5 KMS callback)失败、被取消、或被任意中断方式打断(MetaMask 拒签、popup blocker、RPC 抖动、浏览器关闭、tab 切换、页面刷新),wizard SHALL 把链上状态作为唯一权威进度记录。

wizard SHALL 在 5.1 部署交易确认后立即把 `campaignAddress` 写入 localStorage(zustand persist 白名单)。`campaignAddress` 是部署后唯一不可重新派生的字段;所有其它进度信息 SHALL 在重新进入 wizard 时通过链上读取重新计算。

wizard 重新进入 Step 5 时(包括组件重新挂载、tab 切换回来、页面刷新),SHALL 调用纯函数 `deriveStep(chainState, recipients)` 从链上读取的 `(state, balance, allocationCount, recipientCount, allocationSet[r] for r in recipients)` 推导当前应继续的子步骤,SHALL NOT 使用任何 in-memory 进度变量(`deployStep`、`allocatedSoFar`)作为 source of truth。

`deriveStep` SHALL 按以下规则映射:

- `state == Setup` 且 `balance < declaredTotal` → 5.2(fund)
- `state == Setup` 且 `balance >= declaredTotal` 且 `allocationCount < recipientCount` → 5.3(继续 setAllocation,跳过 `allocationSet[r] == true` 的 recipient)
- `state == Setup` 且 `allocationCount == recipientCount` → 5.4(finalize)
- `state == Finalizing` → 5.5(KMS callback)
- `state == Claiming` → 已完成
- `state == Failed` → 进入恢复路径(`cancelCampaign`)

wizard 进入 Step 5 时,如果 store 中存在 `campaignAddress` 但状态不是 Claiming/Failed,SHALL 显示 Resume banner,提示用户当前 campaign 地址与推导出的下一步,并提供"Resume"与"Discard"两个动作。Discard 在链上状态非 Setup 时 SHALL 引导用户先调用 `cancelCampaign` 回收 escrow。

`executeDeployment(ctx, resumeFromStep)` SHALL 接受可选的 `resumeFromStep` 参数,内部 SHALL 跳过 `< resumeFromStep` 的子步骤。已有的链上 idempotency 守卫(5.2 balance check、5.3 `alreadyAllocated`、5.4 state check、5.5 state check)SHALL 保留作为正确性兜底。

#### Scenario: 5.1 完成后 tab 切换

- **WHEN** 子步骤 5.1 部署交易确认,wizard 把 `campaignAddress` 持久化到 localStorage
- **AND** 用户在 5.2 或之后的步骤切换到其他 tab,Step5Deploy 组件 unmount
- **AND** 用户切回 Deploy tab,组件重新 mount
- **THEN** wizard SHALL 从 localStorage 读取 `campaignAddress`,从链上读取 `(state, balance, allocationCount)`,调用 `deriveStep` 推导当前子步骤
- **AND** SHALL 自动从推导出的子步骤继续 `executeDeployment`,无需用户手动点击 Retry

#### Scenario: 5.4 finalize 被 reject 后切 tab

- **WHEN** 子步骤 5.4 用户在 MetaMask 弹窗点击 Reject
- **AND** wizard 错误状态被持久化到 store
- **AND** 用户切到 Review tab 再切回 Deploy tab
- **THEN** wizard SHALL 读链上确认 `state == Setup, allocationCount == recipientCount, balance >= declaredTotal`
- **AND** SHALL 显示 Resume banner,提示"准备 finalize"
- **AND** Resume 按钮点击后 SHALL 直接进入 5.4(`writeContract finalize`),SHALL NOT 重新触发 5.1/5.2/5.3

#### Scenario: 5.3 中途失败后页面刷新

- **WHEN** 子步骤 5.3 第 30 笔 setAllocation 失败,前 29 笔已上链
- **AND** 用户刷新页面后重新进入 wizard
- **THEN** wizard SHALL 通过链上 `allocationSet[r]`(批量 multicall)识别已完成的 29 个 recipient
- **AND** SHALL 跳过这 29 个,从第 30 个开始继续 setAllocation
- **AND** 不依赖 in-memory `allocatedSoFar` 数组

#### Scenario: 链上 state 已 Claiming 但 store 仍说 failed_partial

- **WHEN** 用户重新进入 wizard,store 中 `status == 'failed_partial'`,但链上 `state == Claiming`(此前 finalize 实际成功了,只是 store 没收到信号)
- **THEN** wizard SHALL 以链上为准,显示 "campaign 已 live" 屏幕
- **AND** SHALL 清除 store 中的 `failed_partial` 状态

#### Scenario: 链上 state == Failed

- **WHEN** wizard 重新进入,链上 `state == Failed`(KMS sum check 返回 false)
- **THEN** wizard SHALL 显示 Failed 状态恢复面板
- **AND** 面板 SHALL 暴露调用 `cancelCampaign` 的按钮,点击后回收全部 escrow 给 admin

### Requirement: Step 5 — 5 个上链子步骤

Step 5 SHALL 以 5 个用户可见的子步骤完成部署:(5.1)钱包直接部署合约;(5.2)`token.transfer` 把 `declaredTotal` ZDT 注入合约;(5.3)对每个 recipient 调用 `setAllocation`(客户端 FHE 加密);(5.4)调 `finalize()`;(5.5)等待 KMS callback 把 `finalized` 翻为 true。

每个子步骤 SHALL 实时更新可见进度。子步骤 5.3 SHALL 显示已分配的 recipient 数。每个上链动作 SHALL 是一次独立钱包签名。

每次 `await waitForTransactionReceipt` 后,wizard SHALL 验证 `receipt.status === 'success'`。`receipt.status === 'reverted'` SHALL 立即抛错并停止后续步骤,错误信息 SHALL 包含 tx hash 与子步骤编号。viem 默认不会因链上 revert 抛错,因此这是必要的显式检查;否则一笔静默 revert 的 setAllocation 会让 wizard 把 recipient 标记为已完成并继续到 finalize,导致 finalize 因 `CountMismatch` revert。

#### Scenario: 钱包直接部署(无 Factory)

- **WHEN** 子步骤 5.1 执行
- **THEN** 部署交易 SHALL 由 Admin 钱包发出(`msg.sender = Admin EOA`)
- **AND** SHALL NOT 涉及任何中间 Factory 合约

#### Scenario: 部署前 L3 终检

- **WHEN** Step 5 启动
- **THEN** wizard SHALL 重读 Admin 的 ZDT 余额并重验 `balance >= declaredTotal`
- **AND** SHALL 重验 `draftVersion === snapshot.draftVersion`
- **AND** 任一校验失败时 SHALL 以明确错误信息中止

#### Scenario: setAllocation tx 静默 revert 被检测

- **WHEN** 子步骤 5.3 某笔 setAllocation tx 被矿工打包但合约 revert(例如 `AllocationAlreadySet`、`AlreadyFinalized`、FHE proof 失效)
- **AND** receipt.status === 'reverted'
- **THEN** wizard SHALL 抛 `TxRevertedError`,标记 store `status = 'failed_partial'`
- **AND** SHALL NOT 把该 recipient 加入 `allocatedSoFar`
- **AND** SHALL 显示明确错误信息引导用户 Resume(从链上重新派生应跳过哪些 recipient)

#### Scenario: finalize KMS callback 超时

- **WHEN** 子步骤 5.4 成功,但 active-pull 调用 KMS Gateway publicDecrypt 在重试上限内仍失败(Gateway 不可用)
- **THEN** wizard SHALL 显示超时错误
- **AND** 错误中显示的修复建议 SHALL 包含"Resume 时 wizard 会自动重试 publicDecrypt;若 Gateway 长期不可用,等待 V8 finalize-recovery 上线后使用超时逃生通道"

## ADDED Requirements

### Requirement: Step 5 错误状态跨 mount 持久化

wizard SHALL 把 Step 5 失败信息存入 zustand store 的 `lastDeployError` 字段,SHALL NOT 仅在组件 React state 中保存。`lastDeployError` SHALL 包含 `message`(用户可见的简短描述)、`recovery`(可选的修复建议)与 `kind`(`'kms-timeout' | 'kms-failed' | 'user-rejected' | 'chain-error' | 'register-failed'`)。

`lastDeployError` SHALL 在以下时机自动清除:
- 用户点击 Retry / Resume 按钮
- 当前子步骤推进到下一步成功
- 链上状态推导显示 deploy 已经完成(`state == Claiming`)

`lastDeployError` SHALL 通过 `partialize` 白名单持久化到 localStorage,以保证 tab 切换、页面刷新后 Retry 按钮仍然可见。

#### Scenario: 切 tab 后 Retry 按钮仍可见

- **WHEN** Step 5 因任意原因失败,`lastDeployError` 被写入 store
- **AND** 用户切到其他 wizard step 然后切回 Step 5
- **THEN** Step5Deploy 重新挂载后 SHALL 从 store 读到 `lastDeployError`
- **AND** SHALL 显示与失败时一致的错误卡片与 Retry 按钮

#### Scenario: 推进成功后错误自动清除

- **WHEN** 用户点击 Retry,`executeDeployment` 从断点续跑并推进到下一子步骤
- **THEN** `lastDeployError` SHALL 被自动清除,错误卡片 SHALL 隐藏

### Requirement: zustand 持久化 schema 升级到 v2

wizard 的 zustand store SHALL 把 `PERSIST_SCHEMA_VERSION` 从 `1` 升到 `2`。新版本 `partialize` 白名单 SHALL 包含:`draftId`、`draftVersion`、`currentStep`、`name`、`description`、`recipients`、`auditor`、`snapshot`、`campaignAddress`、`status`、`lastDeployError`。

`allocatedSoFar` 与 `deployStep` SHALL NOT 被持久化,因为它们的 source of truth 已迁移到链上(通过 `deriveStep` 重新计算)。

zustand 持久化中间件的 `migrate` 函数 SHALL 在检测到 `version < 2` 的旧记录时返回 `initialState`,以避免老草稿与新 schema 字段集冲突。用户在升级后第一次进入 wizard SHALL 看到空白草稿。

#### Scenario: 老 v1 草稿被丢弃

- **WHEN** 用户的 localStorage 中存在 `version: 1` 的旧 wizard 草稿
- **AND** 用户在升级后第一次访问 dApp
- **THEN** zustand persist `migrate` SHALL 返回 `initialState`
- **AND** 用户 SHALL 看到空白 wizard,SHALL NOT 看到旧草稿数据

#### Scenario: 5.1 完成后 campaignAddress 立即落地

- **WHEN** 子步骤 5.1 部署 tx 上链确认
- **AND** wizard 调用 `setCampaignAddress(deployedAddress)`
- **THEN** `campaignAddress` SHALL 立即写入 localStorage(zustand persist 同步)
- **AND** 即使下一行代码崩溃或浏览器立刻关闭,`campaignAddress` SHALL 在下次打开时仍可恢复

### Requirement: deriveStep 必须基于 multicall 而非 N 次串行 RPC 调用

`deriveStep` 在判断 5.3 是否完成时,SHALL 通过单次 viem `Multicall3` 调用批量读取 N 个 `allocationSet[r]`,SHALL NOT 串行发起 N 次独立 `readContract` RPC 调用。

为了在 multicall 失败时保持可用性,wizard SHALL 提供 fallback 路径:multicall 失败时降级为分批(每批 ≤ 16)串行 `readContract`。两条路径都失败时,wizard SHALL 显示"无法读取链上状态,请稍后重试"并隐藏 Resume banner,SHALL NOT 用过期或猜测的进度数据驱动 UI。

#### Scenario: N=500 一次 multicall 完成进度推导

- **WHEN** campaign 有 500 个 recipient,用户重新进入 wizard 触发 deriveStep
- **THEN** wizard SHALL 发起 1 次 multicall(包含 500 个 `allocationSet` 调用 + 4 个 state/balance/count 调用)
- **AND** SHALL 在单次 RPC roundtrip 内完成进度推导

#### Scenario: multicall 失败降级到分批读取

- **WHEN** Multicall3 调用失败(RPC 错误、合约地址不可用)
- **THEN** wizard SHALL 自动降级为每批 ≤ 16 个的串行 `readContract` 调用
- **AND** 全部成功后 SHALL 与 multicall 等价地完成推导

#### Scenario: 链上读全部失败时不显示 Resume banner

- **WHEN** multicall 与降级路径均失败
- **THEN** wizard SHALL NOT 显示 Resume banner
- **AND** SHALL 显示明确的"无法读取链上状态"错误,提供手动重试入口

### Requirement: Failed 状态恢复 UI 入口

当 `deriveStep` 推导出链上 `state == Failed`,wizard SHALL 渲染 Failed 恢复面板,直接暴露调用 `cancelCampaign` 的按钮。SHALL NOT 让 admin 离开 wizard 去其他页面才能取回 escrow。

按钮点击后,wizard SHALL 通过 `walletClient.writeContract` 调用 `cancelCampaign()`,该函数 SHALL 把合约余额全部转回 admin 钱包。tx 成功后 wizard SHALL 引导 admin 重置 wizard 草稿(包括清除 `campaignAddress`),为重新部署做准备。

#### Scenario: Failed 状态显示恢复按钮

- **WHEN** 用户进入 wizard,`deriveStep` 检测到链上 state == Failed
- **THEN** wizard SHALL 显示 Failed 恢复面板,包含合约地址、当前 escrow 余额、cancelCampaign 按钮
- **AND** SHALL NOT 显示 Resume / Retry 按钮(避免误导用户尝试推进)

#### Scenario: cancelCampaign 成功后清除草稿

- **WHEN** admin 点击 cancelCampaign 按钮,tx 上链成功
- **THEN** wizard SHALL 显示 "ZDT 已退回钱包" 提示,显示退回数额
- **AND** SHALL 提供"开始新部署"按钮,点击后 SHALL 调用 `useWizardStore.reset()` 清空草稿
