# Landing Page 视觉规范 (v2 终稿)

> **来源**：`docs/index_v2.html`（设计 source-of-truth，不再继续维护）
> **目标**：为 `frontend/src/pages/LandingPage.tsx` 的 React 实现提供完整规范。
> **状态**：已锁定。任何对 Landing Page 的视觉/文案变更必须先改本文件。

---

## 1. 设计基调

- **关键词**：奶油底色 + 金棕 accent + oklch 色彩、流动 orb 背景、噪点纹理、清晰大字标题、低饱和。
- **承诺**：visual 上传达"协议级可信、不浮夸、专业"。
- **支持**：Light + Dark 双主题；EN + zh 双语；`prefers-reduced-motion` 友好。

## 2. 设计 Token

色彩使用 `oklch()`，迁入 Tailwind v4 `@theme` 时直接保留 oklch 数值。

### 2.1 Light（默认）

| Token | 值 | 用途 |
|---|---|---|
| `--color-bg` | `oklch(98.7% 0.008 84)` | 全局背景 |
| `--color-surface` | `oklch(100% 0 0 / 0.74)` | 卡片表面（半透明） |
| `--color-surface-strong` | `oklch(97.2% 0.009 84)` | 卡片内子表面 |
| `--color-fg` | `oklch(20% 0.02 250)` | 主文本 |
| `--color-muted` | `oklch(48% 0.015 250)` | 次文本 |
| `--color-border` | `oklch(88% 0.012 250 / 0.9)` | 边框 |
| `--color-accent` | `oklch(63% 0.17 83)` | 主色（金棕） |
| `--color-accent-soft` | `oklch(93% 0.04 83 / 0.72)` | 主色软底 |
| `--shadow` | `0 20px 50px oklch(30% 0.02 250 / 0.08)` | 卡片阴影 |
| `--hero-glow-a` | `oklch(76% 0.13 84 / 0.22)` | hero orb 1 |
| `--hero-glow-b` | `oklch(62% 0.11 205 / 0.16)` | hero orb 2（蓝青） |
| `--hero-glow-c` | `oklch(68% 0.11 150 / 0.14)` | hero orb 3（绿） |

### 2.2 Dark（`[data-theme="dark"]`）

| Token | 值 |
|---|---|
| `--color-bg` | `oklch(16% 0.022 255)` |
| `--color-surface` | `oklch(22% 0.018 255 / 0.62)` |
| `--color-surface-strong` | `oklch(24% 0.018 255)` |
| `--color-fg` | `oklch(96% 0.006 95)` |
| `--color-muted` | `oklch(73% 0.014 245)` |
| `--color-border` | `oklch(34% 0.018 245 / 0.86)` |
| `--color-accent` | `oklch(77% 0.16 86)` |
| `--color-accent-soft` | `oklch(33% 0.055 85 / 0.56)` |
| `--shadow` | `0 24px 90px oklch(6% 0.01 250 / 0.46)` |
| `--hero-glow-a` | `oklch(75% 0.14 85 / 0.18)` |
| `--hero-glow-b` | `oklch(60% 0.13 225 / 0.22)` |
| `--hero-glow-c` | `oklch(64% 0.13 165 / 0.16)` |

### 2.3 排印 / 间距

| Token | 值 |
|---|---|
| `--font-display` | `"Telegraf", "Suisse Intl", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif` |
| `--font-body` | `"Telegraf", "Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif` |
| `--font-mono` | `"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, monospace` |
| `--radius` | `18px` |
| `--radius-sm` | `12px` |
| `--container` | `1180px` |
| `--header-height` | `78px` |
| `--section-gap` | `clamp(72px, 10vw, 132px)` |
| `--easing` | `cubic-bezier(0.22, 1, 0.36, 1)` |

> 字体降级策略：v2 写了 Telegraf 但**不引 webfont**，直接走系统 fallback（Inter / system-ui）。如果之后要上 Telegraf，加 `<link>` 到 `index.html` 即可，token 不变。

---

## 3. 信息架构 (IA)

| 顺序 | Section | 锚点 | 角色 |
|---|---|---|---|
| 0 | Sticky Header | — | 品牌 + Nav (Proof / Problem / How it works / Preview) + 语言切换 + 主题切换 |
| 1 | Hero | `#top` | eyebrow + 大标题（双行，第二行 accent 着色） + subcopy + 双 CTA + 右下 hero-proof 卡片 |
| 2 | Trust signals | `#proof` | section-head + 3 列 stat cards |
| 3 | Problem vs Solution | `#problem` | section-head + 左右两栏对比 panel |
| 4 | Flow (3 步) | `#flow` | section-head + 3 列 step cards |
| 5 | Product preview | `#preview` | section-head + 3 列卡片，每张内嵌 mock UI 框（纯 div + CSS shape） |
| 6 | Final CTA | — | 左文 + 右按钮的横版 panel |
| 7 | Footer | — | 品牌 slogan + 3 个锚点链接 |

`section-head` 包含 `kicker`（accent 大写小字） + `h2`（巨标题） + 段落，居中，最大宽 640px。

---

## 4. 交互行为

1. **Header Sticky**：滚动时背景 `backdrop-filter: blur(18px)` + bg 与全局背景 78% 混色。
2. **语言切换**：按钮显示当前语言（`EN` ↔ `中文`）。点击切换并写入 `localStorage("zamadrop:v2:lang")`，同步 `<html lang>`。
3. **主题切换**：按钮显示当前模式（`Light` ↔ `Dark`）。点击切换 `<html data-theme>` 并写入 `localStorage("zamadrop:v2:theme")`。
4. **背景 orb**：3 个 `position: fixed` 圆形渐变，`mix-blend-mode: plus-lighter`，`drift` keyframes 缓慢上下漂移。`prefers-reduced-motion: reduce` 时全部停。
5. **导航锚点**：`html { scroll-behavior: smooth }`，section `scroll-margin-top: calc(var(--header-height) + 18px)`。
6. **按钮 hover**：`translateY(-1px)` 微上浮 + 颜色过渡 180ms。

---

## 5. 文案字典

### EN

| Key | Value |
|---|---|
| `navProof` | Proof |
| `navProblem` | Problem |
| `navFlow` | How it works |
| `navPreview` | Preview |
| `eyebrow` | Built on Zama FHE. Designed for public campaigns. |
| `heroTitleA` | Private allocations. |
| `heroTitleB` | Public accountability. |
| `heroCopy` | Confidential token distribution for public Web3 campaigns. Public campaign proof. Private recipient amounts. |
| `heroCtaPrimary` | View product preview |
| `heroCtaSecondary` | See the claim flow |
| `proofLabel` | What stays public vs private |
| `proofTitle` | Merkle proofs still prove who can claim. ZamaDrop protects how much. |
| `proofItem1` | Public sees campaign totals, rules, recipient count, status, and claim progress. |
| `proofItem2` | Recipients decrypt only their own allocation before they claim. |
| `proofItem3` | Auditors verify aggregate claimed totals, never personal allocations. |
| `statsKicker` | Trust / protocol signals |
| `statsTitle` | Public enough to trust. Private where it matters. |
| `statsCopy` | Campaign-level signals stay visible. Personal allocations do not. |
| `stat1Index` | 01 / Campaign transparency |
| `stat1Value` | Public rules |
| `stat1Title` | The campaign remains explainable. |
| `stat1Copy` | Admin publishes total distribution, allocation logic, recipient count, status, and progress so the campaign can still be inspected in public. |
| `stat2Index` | 02 / Allocation privacy |
| `stat2Value` | Private amounts |
| `stat2Title` | Individual allocations stay hidden. |
| `stat2Copy` | Public viewers never learn who received how much. Recipients decrypt only their own number before they claim. |
| `stat3Index` | 03 / Verifiable progress |
| `stat3Value` | Auditable totals |
| `stat3Title` | Aggregate claims remain checkable. |
| `stat3Copy` | Auditors verify claimed totals at the aggregate level, which preserves accountability without opening personal allocation data. |
| `problemKicker` | Problem |
| `problemTitle` | Standard token distribution exposes the strategy. |
| `problemCopy` | Public amounts become a map of who got what, and that leaks more than the campaign intended. |
| `problemPanelIndex` | What the public can infer today |
| `problemPanelTitle` | A standard drop often reveals more than the campaign intended. |
| `problemItem1` | Who received the largest share. |
| `problemItem2` | How the project prioritized contributors, investors, or partners. |
| `problemItem3` | Which recipients become obvious phishing and doxxing targets. |
| `solutionPanelIndex` | What ZamaDrop changes |
| `solutionPanelTitle` | Keep the campaign public. Keep the personal allocation private. |
| `solutionPanelCopy` | ZamaDrop does not replace Merkle eligibility. It adds the missing confidentiality layer on top of public campaign transparency using Fully Homomorphic Encryption from Zama. |
| `flowKicker` | How it works |
| `flowTitle` | A simple flow says more than a crowded diagram. |
| `flowCopy` | Configure. Decrypt. Verify. |
| `flowStep1Label` | Step 01 / Admin |
| `flowStep1Title` | Configure the campaign and declare the public rules. |
| `flowStep1Item1` | Set total distribution, recipient count, and status. |
| `flowStep1Item2` | Declare public allocation ranges and campaign constraints. |
| `flowStep1Item3` | Submit encrypted allocations without revealing exact recipient amounts. |
| `flowStep2Label` | Step 02 / Recipient |
| `flowStep2Title` | Decrypt only your own allocation and claim it. |
| `flowStep2Item1` | Prove eligibility through the Merkle path. |
| `flowStep2Item2` | Use Zama-powered decryption for a single personal allocation. |
| `flowStep2Item3` | Claim without exposing your amount to the rest of the campaign. |
| `flowStep3Label` | Step 03 / Public + Auditor |
| `flowStep3Title` | Verify progress and aggregate claimed totals. |
| `flowStep3Item1` | Public sees totals, rules, count, status, and progress. |
| `flowStep3Item2` | Auditor checks aggregate claimed totals only. |
| `flowStep3Item3` | No role outside the recipient can inspect a personal allocation value. |
| `previewKicker` | Product preview |
| `previewTitle` | Three simple surfaces. |
| `previewCopy` | One for Admin, one for Recipient, one for public progress. |
| `preview1Tag` | Admin view |
| `preview1Title` | Campaign setup with public totals and encrypted personal amounts. |
| `preview1Copy` | Admin declares what the campaign should expose publicly, while the specific allocation data remains confidential. |
| `preview2Tag` | Recipient view |
| `preview2Title` | A focused claim surface for one person and one allocation. |
| `preview2Copy` | Recipients decrypt only their own number and claim without browsing everyone else's distribution data. |
| `preview3Tag` | Public progress |
| `preview3Title` | A public surface that shows progress without exposing recipients. |
| `preview3Copy` | Observers track campaign status and aggregate movement without turning the drop into a public ranking of personal allocations. |
| `ctaKicker` | Final call |
| `ctaTitle` | Run a public campaign without exposing every allocation. |
| `ctaCopy` | Public accountability for the campaign. Privacy for the recipient. |
| `ctaButton` | Back to top |
| `footerCopy` | Powered by Zama Protocol. Merkle proofs prove who can claim. ZamaDrop protects how much. |
| `footerLink1` | Trust |
| `footerLink2` | Flow |
| `footerLink3` | Preview |

### zh

| Key | Value |
|---|---|
| `navProof` | 证明 |
| `navProblem` | 问题 |
| `navFlow` | 流程 |
| `navPreview` | 预览 |
| `eyebrow` | 基于 Zama FHE。为公开活动设计。 |
| `heroTitleA` | 私有分配。 |
| `heroTitleB` | 公开问责。 |
| `heroCopy` | 面向公开 Web3 活动的机密代币分发。活动公开可验证，个人金额保持私密。 |
| `heroCtaPrimary` | 查看产品预览 |
| `heroCtaSecondary` | 查看领取流程 |
| `proofLabel` | 什么是公开的，什么是私密的 |
| `proofTitle` | Merkle 证明继续证明谁能领，ZamaDrop 保护的是领多少。 |
| `proofItem1` | 公众可以看到活动总量、规则、人数、状态和领取进度。 |
| `proofItem2` | 受益人只会在领取前解密属于自己的那一笔分配。 |
| `proofItem3` | 审计员只验证聚合后的已领取总额，不接触个人分配。 |
| `statsKicker` | 信任 / 协议信号 |
| `statsTitle` | 公开到足够建立信任，私密到刚好保护个人。 |
| `statsCopy` | 活动级信号公开，个人分配不公开。 |
| `stat1Index` | 01 / 活动透明 |
| `stat1Value` | 公开规则 |
| `stat1Title` | 活动仍然是可解释的。 |
| `stat1Copy` | Admin 公开总分发量、分配逻辑、人数、状态和进度，因此整个活动依然可以被外部审视。 |
| `stat2Index` | 02 / 分配私密 |
| `stat2Value` | 私密金额 |
| `stat2Title` | 个人分配保持隐藏。 |
| `stat2Copy` | 公众无法知道谁拿了多少。Recipient 只会在领取前解密自己的那一个数字。 |
| `stat3Index` | 03 / 进度可审计 |
| `stat3Value` | 可验证总额 |
| `stat3Title` | 聚合领取额依然可检查。 |
| `stat3Copy` | Auditor 在聚合层面验证已领取总额，在不打开个人数据的前提下保留问责能力。 |
| `problemKicker` | 问题 |
| `problemTitle` | 标准代币发放会暴露分配策略。 |
| `problemCopy` | 当金额公开时，整场活动就变成了一张谁拿了多少的公开地图。 |
| `problemPanelIndex` | 今天公众能推断出什么 |
| `problemPanelTitle` | 标准空投通常暴露的信息远超活动本意。 |
| `problemItem1` | 谁拿到了最大的份额。 |
| `problemItem2` | 项目如何优先对待贡献者、投资人或合作伙伴。 |
| `problemItem3` | 哪些受益人成为明显的钓鱼和 doxxing 目标。 |
| `solutionPanelIndex` | ZamaDrop 改变了什么 |
| `solutionPanelTitle` | 让活动继续公开，让个人分配继续私密。 |
| `solutionPanelCopy` | ZamaDrop 不替代 Merkle eligibility。它是在公开活动透明度之上，再叠加一层由 Zama Fully Homomorphic Encryption 提供的机密层。 |
| `flowKicker` | 工作方式 |
| `flowTitle` | 一个简单流程，比拥挤概念图更有说服力。 |
| `flowCopy` | 配置。解密。验证。 |
| `flowStep1Label` | 步骤 01 / Admin |
| `flowStep1Title` | 配置活动，并声明公开规则。 |
| `flowStep1Item1` | 设置总分发量、受益人数和活动状态。 |
| `flowStep1Item2` | 声明公开的分配区间和活动约束。 |
| `flowStep1Item3` | 提交加密后的个人分配，而不暴露精确金额。 |
| `flowStep2Label` | 步骤 02 / Recipient |
| `flowStep2Title` | 只解密自己的分配，并完成领取。 |
| `flowStep2Item1` | 通过 Merkle 路径证明资格。 |
| `flowStep2Item2` | 借助 Zama 的能力完成单个个人分配的解密。 |
| `flowStep2Item3` | 在不向整个活动公开金额的前提下完成领取。 |
| `flowStep3Label` | 步骤 03 / Public + Auditor |
| `flowStep3Title` | 验证进度与聚合领取总额。 |
| `flowStep3Item1` | Public 看到总量、规则、人数、状态和进度。 |
| `flowStep3Item2` | Auditor 只检查聚合后的已领取总额。 |
| `flowStep3Item3` | 除 Recipient 外，没有任何角色可以查看个人分配数值。 |
| `previewKicker` | 产品预览 |
| `previewTitle` | 三个简单界面。 |
| `previewCopy` | Admin、Recipient、公开进度，各自清楚。 |
| `preview1Tag` | Admin 视图 |
| `preview1Title` | 公开总量，隐藏个人金额的活动配置面板。 |
| `preview1Copy` | Admin 决定哪些活动信息应该公开，同时让具体分配数据保持机密。 |
| `preview2Tag` | Recipient 视图 |
| `preview2Title` | 一个人，只看到自己的一笔分配。 |
| `preview2Copy` | Recipient 只解密并领取自己的金额，不需要浏览整个活动的他人数据。 |
| `preview3Tag` | 公开进度 |
| `preview3Title` | 公开显示进度，但不暴露受益人。 |
| `preview3Copy` | 观察者可以跟踪活动状态和聚合进度，而不会把整个空投变成个人分配排行榜。 |
| `ctaKicker` | 最后一段 |
| `ctaTitle` | 发起公开活动，不必公开每个人的数字。 |
| `ctaCopy` | 活动公开问责，个人分配私密可控。 |
| `ctaButton` | 回到顶部 |
| `footerCopy` | Powered by Zama Protocol。Merkle 证明谁能领，ZamaDrop 保护领多少。 |
| `footerLink1` | 信任 |
| `footerLink2` | 流程 |
| `footerLink3` | 预览 |

---

## 6. 与 dApp 的衔接

- Landing 页面挂在 `/`，提供"View product preview" / "See the claim flow" 两个 CTA。
- 两个 CTA 都跳到 `/campaign`（Public Tab），由用户自行从那里进入 Admin/Recipient/Auditor。
- Landing 页**不接钱包**，不引入 wagmi/viem，保持加载快、SEO 友好。
- Header 多加一个右上角"Open dApp"次级链接（直接跳 `/campaign`），方便老用户跳过营销页。

---

## 7. 实现备注

- React 实现位置：`frontend/src/pages/LandingPage.tsx`
- 设计 token 落地：`frontend/src/index.css` 的 `@theme` + `[data-theme="dark"]` 块
- 不引入新依赖（不要装 i18next / next-themes），用 `useState + useEffect + localStorage` 完成 60 行内
- 删除遗留：`LandingPageA.tsx` / `LandingPageB.tsx` / `LandingPageC.tsx`，以及 `App.tsx` 里的 V_A/V_B/V_C 浮窗
- 响应式断点：`1040px`（grid 折单列）、`780px`（header 折叠 + container 收紧）

## 8. 验收标准

- [ ] Light / Dark 主题切换可见生效，且刷新后保留
- [ ] EN / 中文 切换可见生效，且刷新后保留
- [ ] 4 个锚点 nav 平滑滚动到对应 section
- [ ] 移动端（≤780px）布局不破
- [ ] `prefers-reduced-motion: reduce` 时 orb 停止漂移
- [ ] `npm run build` 编译无错
