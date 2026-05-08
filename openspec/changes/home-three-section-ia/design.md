## Context

ZamaDrop 当前 app 首页 `frontend/src/pages/Home.tsx` 是 v7 时代为"recipient/auditor 不知道协议在做什么"的早期假设设计的——首页里塞入大量教学模块(Entry points 三步、Overview 四张 metric、右侧 InfoCard 三张),Hero 用 `Campaign Directory` 标题加一段 functional 描述。该假设在 ZamaDrop landing page(`zamadrop.xyz`)上线、教育职责前移到 landing 后已不成立。

参考 launch 后的 confidential infra / financial infra(Sablier、Snapshot、Uniswap、Aave),product app 首页默认用户已经在 landing 阶段被说服,直接呈现工具界面。本次 change 把 ZamaDrop app 首页对齐这一惯例。

讨论中识别但放 P1 backlog 的项目:contextual disclosure(claim/audit 操作页内的 inline 隐私提示)、TopBar 未连接时的 Create campaign 入口、Trust model 三栏(已决定不放 app 首页)、用户意图筛选(`My access` / `Created by me` / `Auditor access`,与 FHE 隐私边界冲突)。

## Goals / Non-Goals

**Goals:**

- 首页 IA 收敛为三段:Hero(working header)、Discovery controls、Directory grid。
- Hero 极简化,不做 marketing,呈现工作台 header。
- Directory 卡片以"主信息 → Your role badge → 二级地址信息"三层呈现,弱化区块浏览器味。
- 状态名展示文案使用用户语言,内部数据模型保持合约状态机字段,通过映射层隔离。
- Empty state 分两种(全空 / 筛选无结果)。
- 视觉系统不变更,所有改动通过现有 shadcn 组件与 utility class 完成。

**Non-Goals:**

- 不修改合约、indexer、SIWE 鉴权、wagmi 调用集合。
- 不引入用户意图筛选(`My access` 等)。
- 不调整 TopBar 连接前/后逻辑。
- 不在首页加入 Trust model 三栏或角色教学卡。
- 不调整视觉 token、字体、卡片基础样式。
- 不在 claim / audit / wizard 页内插入 contextual disclosure(P1 处理)。

## Decisions

### Decision 1:Hero 极简化 + 移除教学模块

**选择**:删除 `Entry points` card、`Overview` 四张 metric card、右侧 sidebar 三张 InfoCard。Hero 改为单卡 working header(标题 + 一句副文案 + 主/次 CTA),高度约为当前实现的 50–60%。

**Rationale**:landing page 已承担教育职责;app 首页教学模块对从 landing 进来的用户是冗余,对 recipient(被通知带 link 进来)和 admin(熟悉 web3)同样冗余。Sablier `app.sablier.com` / Snapshot / Uniswap 等同类基础设施 product app 首页都不重复 marketing。

**Alternatives considered**:

- 保留 Overview 四张 metric card,只删 Entry points。否决:metric card 的指标(Campaigns tracked / Claiming live / Setup in progress / Recipients tracked)在 Directory grid 已经能数出来,留下也是冗余 metric;同时 metric 卡片占据屏幕黄金位置,推迟用户看到 Directory。
- 保留右侧 sidebar 但内容改为"三角色信任模型"(讨论中前期方案)。否决:landing 已讲过,违反"教育职责前移"原则;且 sidebar 占据右侧 320px 宽度,挤压 Directory grid。

### Decision 2:状态名映射层(数据模型保留合约术语,UI 翻译用户语言)

**选择**:保留 `DirectoryPhase = "Setup" | "Finalize-pending" | "Claiming" | "Loading"` 类型,新增 `phaseLabel(phase: DirectoryPhase): string` 与 `phaseFilterLabel(filter: StatusFilter): string` 两个映射函数。UI 仅引用映射函数返回值。

具体映射:

| 内部 phase           | UI 文案    |
| -------------------- | ---------- |
| `Setup`              | `Pending`  |
| `Finalize-pending`   | `Verifying`|
| `Claiming`           | `Live`     |
| `Loading`            | `Loading`  |

筛选下拉的选项:

| filter value         | UI 文案    | 命中 phase                       |
| -------------------- | ---------- | --------------------------------- |
| `all`                | `All`      | 任意                              |
| `live`               | `Live`     | `Claiming`                        |
| `closed`             | `Closed`   | `Setup` 或 `Finalize-pending`     |

**Rationale**:用户视角的"还没开始 / 进行中 / 已结束"远比合约状态机三段更易理解;同时保留内部类型避免散落字符串导致后续维护成本。这种"内部技术名 + 展示映射"模式是 Snapshot / Aave 治理界面的标准做法。

`Closed` 同时覆盖 `Setup` 和 `Finalize-pending` 是有意为之——从普通用户角度,这两种状态都是"现在还领不到",不需要区分。审计或 admin 进入 detail 页才需要看到 `Verifying` 这种细分状态。

**Alternatives considered**:

- 直接 rename 合约状态机术语。否决:破坏前后端类型一致性,且 `Setup`/`Finalize-pending`/`Claiming` 在合约 events / docs / ADR 中已固定。
- 三选项(`All` / `Live` / `Pending`),把 Pending 单独列出。否决:多一档选项收益小,会让筛选条变长。

### Decision 3:Your role badge 的获取与显示

**选择**:复用 `useRoleInfo(walletAddress, campaignAddress)` hook,把 `roleLabels` 从 `CampaignCard` 内部展示挪到第四行作为独立 badge。判断 recipient 的实现 SHALL 仅使用现有 hook 已有逻辑,不引入新链上数据获取。

显示规则:

- `!isConnected`:badge 显示 `Connect wallet to see your role`,`onClick` 调用与"Create campaign"按钮相同的连接流程。
- `isConnected && roleLabels.length > 0`:badge 显示 `roleLabels.join(" · ")`,例如 `Admin`、`Auditor`、`Recipient`、`Admin · Auditor`。
- `isConnected && roleLabels.length === 0`:badge 显示 `Not involved`。

**Rationale**:Your role 是 FHE 项目里最有信息量的"行为引导"——recipient 看到自己被分配后才知道下一步去 claim。把它从 CampaignCard 当前的"Header 右上角次要 badge"提升到第四行独立行,显著提高发现率。

**Trust 假设**:`useRoleInfo` 是否能在 FHE 隐私约束下判断 recipient 取决于 `useRoleInfo` 内部实现;本次 design 不改 hook,只改它结果如何被展示。如果 `useRoleInfo` 当前对非 admin / 非 auditor 钱包返回 `roleLabels = []`(无法识别 recipient),Your role badge 在该场景显示 `Not involved`——这是合约层 recipient 列表加密时的可接受行为。recipient 自己进入 detail 页可以通过 `requestMyAllocation` 解密验证身份。

**Alternatives considered**:

- 在 Home 层新增链上扫描判断"我是不是 recipient"。否决:违反 FHE 隐私边界(recipient 名单加密),也违反"不引入新链上调用"约束。
- 未连接钱包时不显示 Your role 行。否决:连接钱包是行为引导的最大杠杆,placeholder 本身就是 CTA。

### Decision 4:卡片信息层级与 CampaignCard 改造

**选择**:重写 `CampaignCard.tsx` 视觉层级,不动数据获取部分。

新的卡片结构(从上到下):

```
[Status badge (Live/Pending/...) ] [Privacy badge: FHE-encrypted]

<Campaign name or short-address>             — h3 sized, font-semibold

┌──────────────────┬──────────────────┐
│ Declared total   │ Recipients        │      — 主信息,大字号
│ 1,000,000 USDC   │ 250               │
└──────────────────┴──────────────────┘

[ Your role badge ]                            — 第四行,独立 badge

— 灰色细线分隔 —

Created by 0xab…12 · Auditor 0xcd…34 · Token USDC      — 二级,小字灰色
                                              hover 显示 Etherscan 链接
```

**Rationale**:当前 CampaignCard 把 `View on Etherscan ↗` 作为标题正下方的 CardDescription,把 admin/auditor/token 作为三个 InlineField 与主信息 MetricPill 几乎同等视觉权重——这是区块浏览器风格,不是产品风格。重排后主信息(数字)成为视觉焦点,审计字段保留但降级。

**Alternatives considered**:

- 隐藏 admin/auditor/token 完整地址,只显示主信息。否决:审计场景需要核对地址,完全藏起来会让 auditor 必须点进 detail 才能验地址。
- 把卡片改成单列竖排所有字段。否决:视觉密度过低,Directory 列表会非常长,违反"目录页"形态。

### Decision 5:Empty state 分流的实现位置

**选择**:在 `Home.tsx` 内部判断,而非新增独立 EmptyState 组件树。

```ts
const isAllEmpty = directoryItems.length === 0;
const isFilterEmpty = !isAllEmpty && filteredItems.length === 0;
```

两个 EmptyState 共用同一容器 styles,只换 title / body / CTA。`Clear filters` CTA 调用 `setQuery("")`、`setStatusFilter("all")`、`setSortBy("recent")` 三个 setter。

**Rationale**:两种 empty state 共享视觉容器、只差文案与 CTA,抽象组件得不偿失。直接条件渲染最小改动。

### Decision 6:CTA 顺序与 `Browse campaigns` 行为

**选择**:Hero 主按钮 `Create campaign`(左)、次按钮 `Browse campaigns`(右)。`Browse campaigns` 点击行为保留当前实现的 `scrollIntoView` 至 Directory section。

**Rationale**:landing → app 的用户漏斗里,真正主动来首页的是项目方;recipient 是带 campaign URL 来的,不会停留在 `/`。所以 Create 是主行动,Browse 是次。

文案 `Create campaign`(动词短语,无冠词)比当前的 `Start a campaign` 更工具化、更直接,符合 confidential infra 的语气。

## Risks / Trade-offs

**Risk:删除 Overview metric 卡片可能让 demo / 投资人 review 看起来"信息少了"** → Mitigation:Directory grid 本身已经按状态分组渲染,数字不会"消失",只是不再被预先聚合到顶部。如果 demo 场景确实需要"项目级总览"数据,P1 可以在 footer 加一行轻量统计行(单行、不占据屏幕黄金位)。

**Risk:`Closed` 同时覆盖 `Setup` + `Finalize-pending` 可能让 admin 在筛选时看不到自己刚提交还在 verifying 的 campaign** → Mitigation:admin 应通过 detail 页(已有 Admin tab)管理自己的 campaign,而不是首页筛选;首页是公共目录,admin 自查路径在 P1 backlog 里(`Created by me` 筛选若未来要做)。

**Risk:`Your role` badge 未连接时点击触发 connect,如果 connect 流程失败(无 provider / 用户取消),用户卡在 placeholder** → Mitigation:与现有 `Create campaign` 按钮共用 `startCampaign` / 等价的连接函数;`useConnect` 错误已有 Alert UI 处理,沿用同一错误反馈通道。

**Risk:状态映射层引入了 `Verifying` 这种新文案,如果用户在 detail 页看到 `Finalize-pending` 而首页看到 `Verifying` 会困惑** → Mitigation:detail 页(AdminPage / Overview)同步采用 `phaseLabel` 映射函数。具体替换列入 tasks.md;如果 detail 页改造超出当前 change 范围,只在 Home + Card 范围内使用映射,detail 页保持现状,可在 P1 统一。本次 design 倾向**只在首页与卡片用映射**,detail 页不动——首页是公众场景,detail 页是已经进入交互的场景,术语略不一致是可接受 trade-off。

**Risk:Trust assumption 错误——`useRoleInfo` 实际上有判断 recipient 的能力,但本 design 假设它没有** → Mitigation:tasks.md 第一个调研步骤会读 `frontend/src/useRoleInfo.ts` 确认其实际能力,据此决定 `Your role` badge 在 recipient 场景下的具体显示。如果 hook 已能识别 recipient,直接复用即可;如果不能,显示 `Not involved` 是符合 FHE 隐私边界的诚实表达。

## Migration Plan

无 schema / 数据迁移。前端纯 UI 重构,部署即生效。

回滚:revert 单个 frontend PR 即可恢复当前 Home + CampaignCard 实现。

## Open Questions

1. `phaseLabel` 映射(Setup → Pending、Finalize-pending → Verifying、Claiming → Live)是否需要 product owner 最终敲定?当前文案已基于讨论结论选定,实施时若 owner 想改,只需修改单个映射函数。
2. Privacy badge 文案 `FHE-encrypted` 是否使用现有 `cipher` Badge variant?计划复用——已经在视觉系统里有定义,无需新增。
3. `Not involved` 文案是否需要更柔和的措辞(如 `View only`)?保留 open,实施时取一种,P1 可调整。
