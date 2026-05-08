# campaign-directory Specification

## Purpose
TBD - created by archiving change home-three-section-ia. Update Purpose after archive.
## Requirements
### Requirement: 首页采用三段式 IA

App 首页(`/`,即 `frontend/src/pages/Home.tsx`)SHALL 由且仅由三个顶层区块构成,从上到下依次为:Hero、Discovery controls、Directory grid。教学性质的角色介绍、Trust model 解释、Overview metrics、Entry points 引导步骤 SHALL NOT 出现在 app 首页——这些教育职责由 `zamadrop.xyz` landing page 与 docs 承担。

#### Scenario: 首页只渲染三个顶层区块

- **WHEN** 用户(已连接或未连接钱包)打开 `/`
- **THEN** 主内容区 SHALL 渲染恰好三个顶层 section:Hero、Discovery controls、Directory grid
- **AND** SHALL NOT 渲染 `Entry points`、`Overview metrics`、`Wallet actions` / `Privacy boundary` / `Directory cues` 三张 InfoCard

#### Scenario: 教学内容不出现在 app 首页

- **WHEN** 用户首次进入 app 首页
- **THEN** 页面 SHALL NOT 包含"What is ZamaDrop"、"How it works"、Public/Recipient/Auditor 三角色解释这类静态教学模块
- **AND** 任何"了解协议原理"链接 SHALL 跳出到 `zamadrop.xyz` 或 docs

### Requirement: Hero 是工作台 header,不做 marketing

Hero 区块 SHALL 作为工作台 header 存在,职责限于:呈现页面标题、一句基础设施定位副文案、主 CTA `Create campaign`、次 CTA `Browse campaigns`。Hero SHALL NOT 包含产品价值主张式的长文案、3 步以上的引导列表、metric 数字卡片、教学卡片。

#### Scenario: Hero 内容收敛

- **WHEN** 用户进入 `/`
- **THEN** Hero SHALL 包含且仅包含以下元素:页面标题(单行)、一句副文案(不超过 120 字符)、`Create campaign` 主按钮、`Browse campaigns` 次按钮
- **AND** Hero 区块的垂直高度 SHALL 不超过当前实现 `Campaign Directory` Hero 高度的 60%

#### Scenario: 主 CTA 顺序与文案

- **WHEN** Hero 渲染 CTA 按钮
- **THEN** 主按钮 SHALL 标签为 `Create campaign`(不是 `Start a campaign`)
- **AND** 主按钮 SHALL 居于次按钮之左
- **AND** 次按钮 SHALL 标签为 `Browse campaigns`,点击后滚动至 Directory grid

### Requirement: Discovery controls 提供搜索/状态筛选/排序

Discovery controls 区块 SHALL 提供三类控件:campaign 地址搜索、状态筛选、排序选项。状态筛选选项 SHALL 使用用户语言文案(例如 `Live` / `Closed`),不直接暴露合约状态机术语(`Setup` / `Finalize-pending` / `Claiming`)给用户。内部数据模型 MAY 仍使用合约状态机字段,但展示文案 SHALL 经映射层翻译。

#### Scenario: 状态筛选使用用户语言

- **WHEN** 用户打开状态筛选下拉
- **THEN** 选项 SHALL 包含 `All`、`Live`(对应合约 `Claiming`)、`Closed`(对应合约 `Setup` 或 `Finalize-pending`)
- **AND** SHALL NOT 直接展示 `Setup`、`Finalize-pending`、`Claiming` 这些字面值

#### Scenario: 搜索按地址子串过滤

- **WHEN** 用户在搜索框输入 `0xab`
- **THEN** Directory grid SHALL 只渲染地址(小写)包含 `0xab` 子串的 campaign

#### Scenario: 排序选项保留

- **WHEN** 用户选择排序方式
- **THEN** 可选项 SHALL 至少包含:`Directory order`(默认)、`Largest declared total`、`Most recipients`、`Address`

### Requirement: Directory 卡片按"主信息→Your role→二级地址"分层

Directory grid 中每张 campaign 卡片 SHALL 按以下视觉层级从上到下渲染信息:

1. 第一行:状态 badge(用户语言文案)+ privacy badge(`FHE-encrypted`)
2. 第二行:campaign 名称;若无名称则 fallback 为短地址 `0xabcd…1234`
3. 第三行(主信息):`Declared total` 数字 + `Recipients` 数字
4. 第四行(行为引导):`Your role` badge
5. 底部(二级信息):`Created by 0x… · Auditor 0x…` 灰色小字,字号 ≤ 12px

Etherscan 链接 SHALL NOT 出现在卡片首行;Admin、Auditor、Token 三个完整地址字段 SHALL NOT 占据等同于主信息的视觉权重。

#### Scenario: 卡片首屏只显示用户能理解的活动状态

- **WHEN** 任意访客在 Directory grid 中查看一张卡片
- **THEN** 不滚动卡片内部的情况下,首屏可见的元素 SHALL 包含:状态 badge、privacy badge、campaign 名称或短地址、declared total、recipient count、Your role badge
- **AND** 完整 admin / auditor / token 地址 SHALL 以灰色小字呈现在卡片底部,字号小于主信息

#### Scenario: 卡片不再以地址为标题

- **WHEN** 卡片渲染标题
- **THEN** 标题区域 SHALL 优先显示 campaign 名称(如有);无名称时显示短地址
- **AND** SHALL NOT 把 `View on Etherscan ↗` 链接放在标题正下方作为主描述

### Requirement: Your role badge 行为引导

每张 Directory 卡片 SHALL 在第四行显示 `Your role` badge,作为已连接钱包用户的行为引导:

- 钱包未连接:badge SHALL 显示 placeholder 文案 `Connect wallet to see your role`,点击 SHALL 触发钱包连接流程
- 钱包已连接,且地址匹配 admin / auditor / recipient:badge SHALL 显示 `Admin` / `Auditor` / `Recipient`(可叠加,例如 `Admin · Auditor`)
- 钱包已连接,且地址不匹配任何角色:badge SHALL 显示 `Not involved`

判断"是否 recipient"的实现 MAY 使用现有 `useRoleInfo` hook 中等价逻辑;本需求不引入新的链上数据获取或对 FHE 隐私边界的额外依赖。

#### Scenario: 未连接钱包显示 placeholder

- **WHEN** 用户未连接钱包并访问 `/`
- **THEN** 每张卡片的 Your role 行 SHALL 显示 `Connect wallet to see your role`
- **AND** 点击该 badge SHALL 触发与"Create campaign"按钮相同的钱包连接流程

#### Scenario: 已连接钱包是 recipient

- **WHEN** 用户连接的钱包地址在该 campaign 是 recipient
- **THEN** 该卡片的 Your role badge SHALL 显示 `Recipient`

#### Scenario: 已连接钱包是 admin 同时是 auditor

- **WHEN** 用户连接的钱包地址既是 admin 又是 auditor
- **THEN** 该卡片的 Your role badge SHALL 显示 `Admin · Auditor`

#### Scenario: 已连接钱包与该 campaign 无关

- **WHEN** 用户连接的钱包地址不是 admin / auditor / recipient
- **THEN** 该卡片的 Your role badge SHALL 显示 `Not involved`

### Requirement: Empty state 分两种

Directory grid 在数据为空时 SHALL 区分两种 empty state:

- 数据源为空(`CAMPAIGNS.length === 0`):显示 `No campaigns yet` 标题 + 主 CTA `Create the first campaign`
- 筛选/搜索后无结果(`filteredItems.length === 0` 但 `directoryItems.length > 0`):显示 `No matching campaigns` 标题 + 次 CTA `Clear filters`(点击重置 query / status / sort)

当前实现只有"筛选无结果"一种 empty state SHALL 被替换。

#### Scenario: 数据源完全为空

- **WHEN** `CAMPAIGNS` 配置为空数组
- **THEN** Directory grid SHALL 显示 `Create the first campaign` CTA
- **AND** SHALL NOT 显示 `Clear filters` CTA

#### Scenario: 仅筛选无结果

- **WHEN** `CAMPAIGNS` 非空但当前筛选/搜索条件下 `filteredItems.length === 0`
- **THEN** Directory grid SHALL 显示 `Clear filters` CTA
- **AND** 点击 CTA SHALL 重置 query 为空字符串、status 为 `all`、sort 为 `recent`

### Requirement: 视觉系统不变更

本次改动 SHALL NOT 修改:Tailwind 配置、shadcn variant、设计 token(颜色 / 字号 / 圆角 / 阴影)、卡片 base styles、字体加载。所有改动 SHALL 通过现有组件组合(`Card` / `Badge` / `Button` 等)与现有 utility class 完成。

#### Scenario: 没有新增视觉 token

- **WHEN** 本 change 实施完成
- **THEN** `frontend/tailwind.config.ts`、`frontend/src/index.css`、shadcn primitive 文件(`frontend/src/components/ui/*`)SHALL 与改动前 byte-identical
- **AND** 任何颜色调整 SHALL 通过已有的 utility class 实现,不通过新增 CSS 变量

### Requirement: 不依赖新链上字段或 indexer 调整

本次首页 IA 改动 SHALL 仅基于当前已读取的合约 view 字段(`declaredTotal`、`recipientCount`、`finalized`、`finalizeCheckHandle`、`admin`、`auditor`、`token`、token 元数据)。SHALL NOT 引入新的合约 view 调用、新的事件订阅、新的 indexer 端点。

#### Scenario: 数据获取调用集合不变

- **WHEN** Home 页面渲染
- **THEN** `useReadContracts` 与各卡片内部 `useReadContract` 调用所请求的 functionName 集合 SHALL 是改动前已存在集合的子集
- **AND** SHALL NOT 新增任何 indexer fetch 或 SIWE-protected API 调用

