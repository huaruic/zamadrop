## 1. 调研与映射层准备

- [x] 1.1 阅读 `frontend/src/useRoleInfo.ts`,确认 hook 通过合约 `allocationSet(addr)` view 能识别 recipient——返回 bool,不破坏 FHE 隐私边界
- [x] 1.2 在 `frontend/src/lib/phase.ts` 实现 `derivePhase` / `phaseLabel` / `phaseFilterLabel` / `matchesFilter` / `phaseBadgeVariant`,统一原本散落在 Home 与 CampaignCard 的实现
- [x] 1.3 在 `frontend/src/lib/phase.test.ts` 编写 vitest 单测,9 个测试全通过

## 2. Hero 改为工作台 header

- [x] 2.1 删除 Hero 内的 3 个 outline Badge、`ZamaDrop` kicker、`No wallet is required ...` 提示
- [x] 2.2 标题改为 `Campaigns`,副文案改为 `Confidential token distribution on Zama fhEVM. Encrypted allocations, on-chain sum check, role-scoped decryption.`
- [x] 2.3 主 CTA 文案改为 `Create campaign`
- [x] 2.4 删除右侧 Entry points 卡片,Hero 退化为单卡
- [x] 2.5 `EntryRow` 组件随之移除

## 3. 移除 Overview metric 区块

- [x] 3.1 整段四张 MetricCard 删除
- [x] 3.2 `MetricCard` 组件定义随之移除
- [x] 3.3 `campaignCount` 等聚合变量与 `formatBigInt` 引用清理(`formatBigInt` 不再被使用,从 Home 删除)

## 4. 移除右侧 sidebar 教学栏

- [x] 4.1 右侧 `<aside>` 三张教育卡删除
- [x] 4.2 Directory 区域改为单列全宽
- [x] 4.3 `InfoCard` / `DirectoryCue` 组件定义随之移除

## 5. Discovery controls 文案与映射

- [x] 5.1 删除 `Vertical directory` badge
- [x] 5.2 状态筛选选项改为 `All / Live / Closed`,过滤通过 `lib/phase.ts` 的 `matchesFilter` 实现
- [x] 5.3 `StatusFilter` 类型从 `lib/phase.ts` 导出统一定义

## 6. CampaignCard 信息层级重排

- [x] 6.1 `CardHeader` 改为状态 badge + `FHE-encrypted` privacy badge 一行;删除 Etherscan 链接副标题
- [x] 6.2 新增 campaign 名称行(短地址 fallback),`text-base font-semibold`
- [x] 6.3 主信息 MetricPill(declared total + recipients)保留并位于 Your role 上方
- [x] 6.4 新增 `YourRoleRow` 组件,处理三种状态(未连接 / 有角色 / 无角色)
- [x] 6.5 admin / auditor / token 改为底部单行 `text-[11px] text-muted-foreground`,Etherscan 链接 hover 出现
- [x] 6.6 `CardFooter` `◢ Per-recipient amounts encrypted with FHEVM` 删除
- [x] 6.7 Header 右上角原 `You · ...` badge 删除(信息迁移到 Your role 行)
- [x] 6.8 抽出 `frontend/src/lib/use-connect-wallet.ts`,Home 与 CampaignCard 共用

## 7. Empty state 分流

- [x] 7.1 Home 计算 `isAllEmpty` / `isFilterEmpty`
- [x] 7.2 `EmptyState` 组件接受 `mode` / `onClearFilters` / `onCreateCampaign`
- [x] 7.3 `all-empty` 模式渲染 `Create the first campaign` 主 CTA
- [x] 7.4 `filter-empty` 模式渲染 `Clear filters` 次 CTA,点击重置 query/status/sort
- [x] 7.5 渲染顺序按 `isAllEmpty → isFilterEmpty → list`

## 8. 验证

- [x] 8.1 `npm run lint` 通过(残留 6 个 pre-existing 错误在 `badge.tsx` / `button.tsx` / `fhevm.ts`,与本 change 无关)
- [x] 8.2 `npm run build` 通过(`tsc -b` 无错误,vite build 成功)
- [x] 8.2.1 `npx vitest run` 全套 33 个测试通过(包含新增 9 个 phase 测试)
- [ ] 8.3 启动 `npm run dev` 浏览器手动验证(留给用户在 dev 环境跑,本次未启动浏览器)
- [ ] 8.4 截图对比 Before/After 贴 PR description(留给 PR 阶段)
- [x] 8.5 `openspec validate home-three-section-ia --type change` 通过

## 9. 善后

- [x] 9.1 `docs/WORKLOG.md` 追加摘要
- [ ] 9.2 PR description 注明 P1 backlog(留给 PR 创建时填写)
