# Change 005: Day 5 — Frontend 四角色界面

> ⚠️ **SUPERSEDED** (2026-05-06) — 本 spec 描述的是 wave 1 + wave 2 的 tab-per-role 设计 (`PublicTab` / `AdminTab` / `RecipientTab` / `AuditorTab`)。Frontend 后续完全重写，落地为 V6 capability-tab IA：
>
> - 路由：React Router 7（`/`、`/campaign/:address` 及其子路径 `admin` / `me` / `audit`）
> - 入口：[`frontend/src/pages/CampaignLayout.tsx`](../../../frontend/src/pages/CampaignLayout.tsx)
> - 角色页：[`frontend/src/pages/admin/`](../../../frontend/src/pages/admin/) · [`frontend/src/pages/recipient/`](../../../frontend/src/pages/recipient/) · [`frontend/src/pages/auditor/`](../../../frontend/src/pages/auditor/)
> - 协议：[`docs/role-page-protocol.md`](../../../docs/role-page-protocol.md) §4
> - 信任模型变化：`callbackFinalize` / `executeTransfer` 不再由前端触发，全部交给 [`scripts/executor.ts`](../../../scripts/executor.ts)；详见 [`docs/security-notes.md`](../../../docs/security-notes.md)
>
> 本目录保留作为开发历史记录，不再描述当前实现。

**状态**: WAVE_1_DONE  
**日期**: 2026-05-03  

## Wave 1（已完成，主线程）
- Vite + React 19 + TypeScript + Tailwind 4 + wagmi 3 + @zama-fhe/relayer-sdk
- `frontend/src/wagmi.ts`：Sepolia 网络配置
- `frontend/src/config.ts`：合约地址常量
- `frontend/src/abis.ts`：合约 ABI（精简）
- `frontend/src/fhevm.ts`：encrypt/userDecrypt/publicDecrypt 工具函数
- `frontend/src/App.tsx`：4 标签框架 + 钱包连接
- `frontend/src/tabs/PublicTab.tsx`：Public 视图（已实现，作为模板）

## Wave 2（并行 3 个 agent）
- [task-admin.md](task-admin.md) — Admin Tab：setAllocation + finalize + callbackFinalize
- [task-recipient.md](task-recipient.md) — Recipient Tab：requestMyAllocation + 解密 + claim + 解密 pendingHandle + executeTransfer
- [task-auditor.md](task-auditor.md) — Auditor Tab：requestClaimedTotalForAuditor + userDecrypt 显示聚合
