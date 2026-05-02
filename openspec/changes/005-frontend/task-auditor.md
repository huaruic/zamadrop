# Task Auditor Tab

## Goal
实现 `frontend/src/tabs/AuditorTab.tsx` —— 审计员视图：通过 user re-encryption 解密 `claimedTotal` 聚合值，证明"可编程合规"——监管能拿到聚合数字但拿不到任何个人金额。

## 输入契约
- 工具：`wagmi` v3 hooks、`useWalletClient`（同 RecipientTab）
- ABI：`CAMPAIGN_ABI` 中的 `requestClaimedTotalForAuditor`（仅 auditor 可调用，view 函数返回密文 handle）
- 配置：`CONTRACTS.campaign`、`AUDITOR_ADDRESS`
- FHE 工具：`userDecryptEuint64(handle, contractAddr, signer)`
- 参考 PublicTab 的样式

## 输出契约

### 文件：`frontend/src/tabs/AuditorTab.tsx`

界面：

1. **守卫**：如果连接的地址不等于 `AUDITOR_ADDRESS`（不区分大小写），显示 "Connect with auditor wallet to use this view"
2. **聚合统计卡片**：
   - 标题 "Claimed Total (Aggregate)"
   - 调用 `requestClaimedTotalForAuditor`（用 useReadContract）拿到密文 handle
   - 显示截断的 handle + 标注 "Encrypted on-chain"
   - 按钮 "Decrypt aggregate"：点击后用 `userDecryptEuint64` 解密
     - 期间显示 "Awaiting signature... Decrypting via KMS..."
     - 成功后大字号显示 "X ZDT"
   - 解密只能由 auditor 钱包完成（合约只 grant 给 auditor 地址）
3. **关键说明卡片**（紫色边框、说明性文字）：
   - 标题 "Programmable Compliance"
   - 内容："Auditor 能解密 claimedTotal 这个聚合值，但**无法**解密任何个人 allocation。这是 FHE 让监管者拿到所需统计数字的同时不破坏个人隐私的体现。"
4. **可选**：再加一个"Limitations"小节，列举 auditor 看不到的东西（个人 allocation、未 claim 的 allocation 等）

### 关键代码点
- `requestClaimedTotalForAuditor` 是个 view 函数，被 useReadContract 自动调用即可。但只有 auditor 钱包查询时不会 revert（合约里有权限校验）；其他钱包查询会 revert。所以在非 auditor 钱包时直接显示守卫信息，不要尝试调这个函数。
- 用 useWalletClient + 转换成 signer 的模式（见 RecipientTab 的输入契约）

## 不可越界
- ❌ 严禁修改 App、fhevm、config、abis、wagmi、其他 Tab 文件
- ❌ 严禁安装新包
- ❌ 严禁 commit
- ❌ 严禁开 dev server

## 验证
- `cd frontend && npx tsc -b` 通过

## 完成回报（不超过 200 字）
- 主要 UI 元素列表
- 守卫逻辑说明
- TypeScript 编译输出
