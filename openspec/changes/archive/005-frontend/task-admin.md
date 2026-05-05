# Task Admin Tab

> ⚠️ **SUPERSEDED** (2026-05-06) — 本任务描述的 `frontend/src/tabs/AdminTab.tsx` 与 `callbackFinalize` 由前端触发的设计已被替换。当前实现：[`frontend/src/pages/admin/AdminPage.tsx`](../../../frontend/src/pages/admin/AdminPage.tsx) + `SetAllocationForm.tsx` + `AllocationLedger.tsx` + `FinalizePanel.tsx`。`callbackFinalize` 不再由前端触发，由 [`scripts/executor.ts`](../../../scripts/executor.ts) 通过 KMS 公开解密自动结算。Admin 页只负责 `setAllocation` + `finalize`。当前协议见 [`docs/role-page-protocol.md`](../../../docs/role-page-protocol.md) §4.2。

## Goal
实现 `frontend/src/tabs/AdminTab.tsx` —— Admin 视图，支持设置 allocation、finalize、提交 callback。

## 输入契约（已存在的工具）
- `wagmi` v3：`useAccount`、`useWriteContract`、`useReadContract`、`useWaitForTransactionReceipt`
- `frontend/src/abis.ts`：`CAMPAIGN_ABI`，包含 `setAllocation`、`finalize`、`callbackFinalize`、`finalizeCheckHandle` 等
- `frontend/src/config.ts`：`CONTRACTS.campaign`、`ADMIN_ADDRESS`、`ETHERSCAN_BASE`
- `frontend/src/fhevm.ts`：`encryptUint64(contractAddr, userAddr, value)`、`publicDecryptEbool(handle)`
- 主页面已通过 `useAccount` 知道连接钱包，AdminTab 内部自己再用一次即可
- 参考 `frontend/src/tabs/PublicTab.tsx` 的样式（dark theme、卡片式布局、Tailwind）

## 输出契约（必须满足）

### 文件：`frontend/src/tabs/AdminTab.tsx`（替换占位实现）

界面包含：

1. **守卫**：如果当前 wallet 地址不等于 `ADMIN_ADDRESS`（不区分大小写），显示 "Connect with admin wallet to use this view"。
2. **状态卡片**：显示 declaredTotal、recipientCount、finalized（这些可从 useReadContract 读到，类似 PublicTab）。
3. **"设置 Allocation" 表单**：
   - 输入框：recipient address (string)
   - 输入框：amount (number)
   - 按钮 "Set Allocation"：点击后
     - 调 `encryptUint64(CONTRACTS.campaign, currentAddress, BigInt(amount))` 拿到 `{handle, proof}`
     - 调 `writeContract` 调用 `setAllocation(recipient, handle, proof)`
     - 用 `useWaitForTransactionReceipt` 等确认
     - 成功后清空表单 + 显示 tx hash 链接到 Etherscan
   - loading / error 状态显示
4. **Finalize 按钮**：
   - 仅当 `finalized=false` 时显示
   - 点击后：先 `writeContract` 调用 `finalize()`，等确认 → 拿 `finalizeCheckHandle()` → 调 `publicDecryptEbool(handle)` 拿 bool（提示用户 "等待 KMS 公开解密 ~30s"）→ 调用 `callbackFinalize(bool)`
   - 整个流程显示进度（"1. 提交 finalize", "2. 等待 KMS 解密", "3. 提交 callback", "✓ 完成"）
5. **历史**：在 finalize 完成后用绿色显示 "Status: Claiming"。

### 风格要求
- 沿用 PublicTab 的卡片样式（border-zinc-800、bg-zinc-900/50、rounded-lg、p-4 等）
- 按钮：bg-purple-600 / hover:bg-purple-500 / disabled:opacity-50
- 错误信息用红色文字显示

## 不可越界
- ❌ 严禁修改 `frontend/src/App.tsx`、`fhevm.ts`、`config.ts`、`abis.ts`、`wagmi.ts`、`PublicTab.tsx`、`RecipientTab.tsx`、`AuditorTab.tsx`
- ❌ 严禁安装新 npm 包
- ❌ 严禁 commit
- ❌ 严禁开启 dev server（主线程会做合并验证）

## 验证
- `cd frontend && npx tsc -b` 必须通过（无类型错误）
- 主线程会跑 dev server 做视觉验证

## 完成回报（不超过 200 字）
- 主要 UI 元素列表
- finalize 流程的关键步骤数
- TypeScript 编译输出
