# Task Recipient Tab

> ⚠️ **SUPERSEDED** (2026-05-06) — 本任务描述的 `frontend/src/tabs/RecipientTab.tsx` 与 `executeTransfer` 由前端触发的设计已被替换。当前实现：[`frontend/src/pages/recipient/RecipientPage.tsx`](../../../frontend/src/pages/recipient/RecipientPage.tsx) + `AllocationCard.tsx` + `ClaimStepper.tsx` + `BalancePanel.tsx`。`executeTransfer` 不再由前端触发，由 [`scripts/executor.ts`](../../../scripts/executor.ts) 通过 KMS 公开解密自动结算。Recipient 页只负责 user-decrypt + `claim`。`useUserDecryptEuint64` hook 见 [`frontend/src/hooks/useUserDecryptEuint64.ts`](../../../frontend/src/hooks/useUserDecryptEuint64.ts)。当前协议见 [`docs/role-page-protocol.md`](../../../docs/role-page-protocol.md) §4.3。

## Goal
实现 `frontend/src/tabs/RecipientTab.tsx` —— 受益人视图：通过 user re-encryption 看自己的加密 allocation、claim、解密 pendingHandle、执行 token transfer 拿到 ZDT。

## 输入契约
- 工具：`wagmi` v3 hooks、`useWalletClient`（用于 EIP-712 签名）
- ABI：`CAMPAIGN_ABI`（含 `requestMyAllocation`、`claim`、`pendingClaimHandle`、`executeTransfer`、`allocationSet`、`finalized`、`claimed`、`transferred`）、`ERC20_ABI`（含 `balanceOf`、`symbol`）
- 配置：`CONTRACTS.campaign`、`CONTRACTS.token`
- FHE 工具：
  - `userDecryptEuint64(handle, contractAddr, signer)` — 解密自己的 allocation。signer 参数需要 `{ signTypedData: (params) => Promise<string>, address: 0x... }`，通过 wagmi 的 `useWalletClient` 拿到 walletClient，封装成这个形状传入
  - `publicDecryptEuint64(handle)` — 解密 pendingClaimHandle 拿到明文金额（用于 executeTransfer 参数）
- 参考 PublicTab 的样式

## 输出契约

### 文件：`frontend/src/tabs/RecipientTab.tsx`

界面：

1. **未连接钱包**：显示 "Connect your wallet to view your allocation"
2. **已连接但 `allocationSet[address] === false`**：显示 "No allocation found for this address. Ask the admin to add you."
3. **正常视图（有 allocation）**：
   - 卡片 1：「Your Encrypted Allocation」
     - 显示当前 allocation handle（用 `requestMyAllocation` 的返回值，view function，调 `useReadContract`）
     - 显示 16 字符的 handle 截断，标注 "Encrypted on-chain"
     - 按钮 "Decrypt my amount"：点击后调 `userDecryptEuint64`，期间显示 "Generating keypair...", "Awaiting signature...", "Decrypting via KMS..."。成功后大字号显示 "X ZDT"。
     - 该解密结果只有当前用户自己看得到。
   - 卡片 2：「Claim & Withdraw」
     - 流程包含 3 步：
       1. **Claim**（如果 `claimed[address]=false`）：按钮 "Claim allocation"，调 `claim()`。完成后状态变成 step 2。
       2. **Public decrypt + Execute transfer**（如果 `claimed=true && transferred=false`）：
          - 自动从合约读 `pendingClaimHandle[address]`
          - 显示 "Awaiting public decrypt (~30s)..."
          - 调 `publicDecryptEuint64(pendingHandle)` 拿到明文金额
          - 然后调 `executeTransfer(address, amount)` 完成转账
          - 这一步可以是按钮触发 "Execute transfer"（手动控制比自动更可控）
       3. **Done**（如果 `transferred=true`）：显示 "✓ Transferred. Check your wallet for ZDT."
   - 卡片 3：「Your ZDT Balance」
     - 用 `useReadContract` 读 `token.balanceOf(address)` 显示，单位 ZDT
4. **未 finalize 时禁用 claim 按钮**，提示 "Waiting for admin to finalize"

### 关键技术点
- `useWalletClient` 返回 `WalletClient | undefined`，需要等它就绪
- 把 walletClient 转成 fhevm.ts 期望的 signer：
  ```ts
  const signer = walletClient ? {
    address: walletClient.account.address,
    signTypedData: (params) => walletClient.signTypedData(params),
  } : null;
  ```
- 使用 `useWriteContract` 提交 claim / executeTransfer，配合 `useWaitForTransactionReceipt`
- 每次写入完成后，相关的 useReadContract 数据需要 refetch（用 `queryClient.invalidateQueries` 或者 wagmi 的 watch 机制；wagmi v3 默认 watch true 即可）

## 不可越界
- ❌ 严禁修改 App、fhevm、config、abis、wagmi、其他 Tab 文件
- ❌ 严禁安装新包
- ❌ 严禁 commit
- ❌ 严禁开 dev server

## 验证
- `cd frontend && npx tsc -b` 通过

## 完成回报（不超过 250 字）
- 主要状态机步骤（Setup / Claim / Transfer / Done）
- userDecrypt 的关键调用代码（5 行内）
- TypeScript 编译输出
