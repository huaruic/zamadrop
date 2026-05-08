## Why

ZamaDrop 用户从 `zamadrop.xyz` landing page 经 Get Started 进入 app(`frontend/src/pages/Home.tsx`),landing 已承担产品定位、FHE 卖点、三角色信任模型的教育职责。但当前 app 首页又用 Overview 四张 metric cards、Entry points 三步引导、右侧 InfoCard 教学栏重新讲了一遍信任边界与角色说明,造成"用户已经被说服后还在被推销"的体验冗余,挡在用户与"开始工作"之间。

同时 Hero 文案是说明文(`Campaign Directory` + 一段功能描述),不是工作台 header;Campaign 卡片主要展示地址 + admin/auditor/token 等链上字段,缺少"你在这个 campaign 里是什么角色"的行为引导,看起来像区块浏览器列表;状态名(`Setup`/`Finalize-pending`/`Claiming`/`Loading`)是合约状态机术语,不是用户语言。

参考 Sablier、Snapshot、Uniswap、Aave 等 confidential infra / financial infra 类产品 launch 后的 product app 形态:landing 讲定位,app 首页直接给工具。本次改动让 ZamaDrop app 首页对齐这一惯例。

## What Changes

- 首页 IA 收敛为三段:**Hero(working header)→ Discovery controls → Directory grid**,中间不再插入教学性质的角色介绍模块。
- Hero 极简化:不做 marketing 标语,只做工作台 header——简短标题(如 `Campaigns`)、一句基础设施定位副文案、主 CTA `Create campaign`、次 CTA `Browse campaigns`。Hero 区域高度比当前减少约 50%。
- **移除** app 首页的以下模块,把教育职责交还 landing page 和 docs:
  - 右侧 `Entry points` 三步引导 card
  - Overview 四张 metric card(`Campaigns tracked` / `Claiming live` / `Setup in progress` / `Recipients tracked`)
  - 右侧 sidebar 三张 `InfoCard`(`Wallet actions` / `Privacy boundary` / `Directory cues`)
- Discovery controls 简化:保留地址搜索、状态筛选、排序;状态选项用用户语言(详见 design.md),不再使用合约状态机术语。
- Directory 卡片信息层级重排:
  1. 第一行:状态 badge + privacy badge
  2. 第二行:campaign 名称(没有名称则 fallback 到短地址)
  3. 第三行(主信息):`Declared total` + `Recipients` 两个数字,字号最大
  4. 第四行(行为引导):`Your role` badge——已连钱包显示 `Recipient` / `Auditor` / `Admin` / `Not involved`,未连钱包显示 placeholder `Connect wallet to see your role`
  5. 底部(二级信息):`Created by ... · Auditor ...` 用灰色小字呈现,Etherscan 链接 hover 出现
- Empty state 分两种:`CAMPAIGNS.length === 0` 时显示 `Create the first campaign` 主 CTA;筛选无结果时显示 `Clear filters` CTA。
- 视觉系统不动:不调整颜色、字体、Tailwind tokens、shadcn variants、卡片圆角与 shadow。本次只动结构(组件组合)与文案(label / status name / CTA wording)。

## Capabilities

### New Capabilities

- `campaign-directory`: 描述首页 campaign 浏览体验的需求——三段式 IA、Hero 工作台职责边界、Discovery controls 必备字段、Directory 卡片信息层级与 Your role badge、Empty state 分流、教学职责交还 landing 的边界。

### Modified Capabilities

无。本次不修改 `privacy-boundary`、`recipient-discovery`、`auditor-verification`、`admin-deployment-flow`、`campaign-contract`、`draft-encryption`、`indexer-service` 等已存在 capability 的需求。前端只复用既有数据(同一组合约 view 调用),不改链上行为、不动 indexer schema、不变更 SIWE 鉴权流程。

## Impact

**Affected code(frontend only)**:

- `frontend/src/pages/Home.tsx` — 主要重构对象,删除 Entry points / Overview metrics / 右侧 InfoCard 三个 section,Hero 与 Directory section 重写,新增 Empty state 分流。
- `frontend/src/components/CampaignCard.tsx` — 卡片信息层级重排,新增 `Your role` 行(包含未连钱包 placeholder),Admin/Auditor/Token 三个 `InlineField` 降级为底部灰色小字。
- 状态名映射工具:`derivePhase` 返回值与 `phaseBadgeVariant` label 显示文案分离——内部仍用 `Setup`/`Finalize-pending`/`Claiming`/`Loading` 作为类型,UI 文案改用户语言映射(具体映射在 design.md 决定)。

**Not affected**:

- 合约 `contracts/ZamaDropCampaign.sol` 与所有链上行为
- Indexer schema 与后端 API
- SIWE 鉴权流程
- TopBar 创建入口可见性(本次不调整 `+ Deploy` 按钮的连接前/后逻辑——P1 处理)
- Contextual disclosure(claim/audit 操作页的 inline 隐私提示)——这是讨论中识别出的 P1 backlog,不在本次范围
- 视觉 token 与 design system

**Out of scope(明确放 P1 backlog)**:

- TopBar 未连接时显示 `Create campaign`
- claim / audit / wizard 页内的 contextual privacy hints
- Trust model 三栏(已决定不放 app 首页,放回 landing)
- 用户意图筛选(`My access` / `Created by me` / `Auditor access`)——与 FHE 隐私边界冲突且服务场景不存在
- 视觉系统调整(卡片样式、密度、动效)
