import { useEffect, useState, type JSX } from "react";

type Lang = "en" | "zh";
type Theme = "light" | "dark";

const dict: Record<Lang, Record<string, string>> = {
  en: {
    navProof: "Proof",
    navProblem: "Problem",
    navFlow: "How it works",
    navPreview: "Preview",
    openDapp: "Open dApp ↗",
    eyebrow: "Built on Zama FHE. Designed for public campaigns.",
    heroTitleA: "Private allocations.",
    heroTitleB: "Public accountability.",
    heroCopy:
      "Confidential token distribution for public Web3 campaigns. Public campaign proof. Private recipient amounts.",
    heroCtaPrimary: "View product preview",
    heroCtaSecondary: "See the claim flow",
    proofLabel: "What stays public vs private",
    proofTitle:
      "Merkle proofs still prove who can claim. ZamaDrop protects how much.",
    proofItem1:
      "Public sees campaign totals, rules, recipient count, status, and claim progress.",
    proofItem2:
      "Recipients decrypt only their own allocation before they claim.",
    proofItem3:
      "Auditors verify aggregate claimed totals, never personal allocations.",
    statsKicker: "Trust / protocol signals",
    statsTitle: "Public enough to trust. Private where it matters.",
    statsCopy:
      "Campaign-level signals stay visible. Personal allocations do not.",
    stat1Index: "01 / Campaign transparency",
    stat1Value: "Public rules",
    stat1Title: "The campaign remains explainable.",
    stat1Copy:
      "Admin publishes total distribution, allocation logic, recipient count, status, and progress so the campaign can still be inspected in public.",
    stat2Index: "02 / Allocation privacy",
    stat2Value: "Private amounts",
    stat2Title: "Individual allocations stay hidden.",
    stat2Copy:
      "Public viewers never learn who received how much. Recipients decrypt only their own number before they claim.",
    stat3Index: "03 / Verifiable progress",
    stat3Value: "Auditable totals",
    stat3Title: "Aggregate claims remain checkable.",
    stat3Copy:
      "Auditors verify claimed totals at the aggregate level, which preserves accountability without opening personal allocation data.",
    problemKicker: "Problem",
    problemTitle: "Standard token distribution exposes the strategy.",
    problemCopy:
      "Public amounts become a map of who got what, and that leaks more than the campaign intended.",
    problemPanelIndex: "What the public can infer today",
    problemPanelTitle:
      "A standard drop often reveals more than the campaign intended.",
    problemItem1: "Who received the largest share.",
    problemItem2:
      "How the project prioritized contributors, investors, or partners.",
    problemItem3:
      "Which recipients become obvious phishing and doxxing targets.",
    solutionPanelIndex: "What ZamaDrop changes",
    solutionPanelTitle:
      "Keep the campaign public. Keep the personal allocation private.",
    solutionPanelCopy:
      "ZamaDrop does not replace Merkle eligibility. It adds the missing confidentiality layer on top of public campaign transparency using Fully Homomorphic Encryption from Zama.",
    flowKicker: "How it works",
    flowTitle: "A simple flow says more than a crowded diagram.",
    flowCopy: "Configure. Decrypt. Verify.",
    flowStep1Label: "Step 01 / Admin",
    flowStep1Title: "Configure the campaign and declare the public rules.",
    flowStep1Item1: "Set total distribution, recipient count, and status.",
    flowStep1Item2:
      "Declare public allocation ranges and campaign constraints.",
    flowStep1Item3:
      "Submit encrypted allocations without revealing exact recipient amounts.",
    flowStep2Label: "Step 02 / Recipient",
    flowStep2Title: "Decrypt only your own allocation and claim it.",
    flowStep2Item1: "Prove eligibility through the Merkle path.",
    flowStep2Item2:
      "Use Zama-powered decryption for a single personal allocation.",
    flowStep2Item3:
      "Claim without exposing your amount to the rest of the campaign.",
    flowStep3Label: "Step 03 / Public + Auditor",
    flowStep3Title: "Verify progress and aggregate claimed totals.",
    flowStep3Item1: "Public sees totals, rules, count, status, and progress.",
    flowStep3Item2: "Auditor checks aggregate claimed totals only.",
    flowStep3Item3:
      "No role outside the recipient can inspect a personal allocation value.",
    previewKicker: "Product preview",
    previewTitle: "Three simple surfaces.",
    previewCopy: "One for Admin, one for Recipient, one for public progress.",
    preview1Tag: "Admin view",
    preview1Title:
      "Campaign setup with public totals and encrypted personal amounts.",
    preview1Copy:
      "Admin declares what the campaign should expose publicly, while the specific allocation data remains confidential.",
    preview2Tag: "Recipient view",
    preview2Title: "A focused claim surface for one person and one allocation.",
    preview2Copy:
      "Recipients decrypt only their own number and claim without browsing everyone else’s distribution data.",
    preview3Tag: "Public progress",
    preview3Title:
      "A public surface that shows progress without exposing recipients.",
    preview3Copy:
      "Observers track campaign status and aggregate movement without turning the drop into a public ranking of personal allocations.",
    ctaKicker: "Final call",
    ctaTitle: "Run a public campaign without exposing every allocation.",
    ctaCopy: "Public accountability for the campaign. Privacy for the recipient.",
    ctaButton: "Back to top",
    footerCopy:
      "Powered by Zama Protocol. Merkle proofs prove who can claim. ZamaDrop protects how much.",
    footerLink1: "Trust",
    footerLink2: "Flow",
    footerLink3: "Preview",
  },
  zh: {
    navProof: "证明",
    navProblem: "问题",
    navFlow: "流程",
    navPreview: "预览",
    openDapp: "打开 dApp ↗",
    eyebrow: "基于 Zama FHE。为公开活动设计。",
    heroTitleA: "私有分配。",
    heroTitleB: "公开问责。",
    heroCopy:
      "面向公开 Web3 活动的机密代币分发。活动公开可验证，个人金额保持私密。",
    heroCtaPrimary: "查看产品预览",
    heroCtaSecondary: "查看领取流程",
    proofLabel: "什么是公开的，什么是私密的",
    proofTitle: "Merkle 证明继续证明谁能领，ZamaDrop 保护的是领多少。",
    proofItem1: "公众可以看到活动总量、规则、人数、状态和领取进度。",
    proofItem2: "受益人只会在领取前解密属于自己的那一笔分配。",
    proofItem3: "审计员只验证聚合后的已领取总额，不接触个人分配。",
    statsKicker: "信任 / 协议信号",
    statsTitle: "公开到足够建立信任，私密到刚好保护个人。",
    statsCopy: "活动级信号公开，个人分配不公开。",
    stat1Index: "01 / 活动透明",
    stat1Value: "公开规则",
    stat1Title: "活动仍然是可解释的。",
    stat1Copy:
      "Admin 公开总分发量、分配逻辑、人数、状态和进度，因此整个活动依然可以被外部审视。",
    stat2Index: "02 / 分配私密",
    stat2Value: "私密金额",
    stat2Title: "个人分配保持隐藏。",
    stat2Copy:
      "公众无法知道谁拿了多少。Recipient 只会在领取前解密自己的那一个数字。",
    stat3Index: "03 / 进度可审计",
    stat3Value: "可验证总额",
    stat3Title: "聚合领取额依然可检查。",
    stat3Copy:
      "Auditor 在聚合层面验证已领取总额，在不打开个人数据的前提下保留问责能力。",
    problemKicker: "问题",
    problemTitle: "标准代币发放会暴露分配策略。",
    problemCopy:
      "当金额公开时，整场活动就变成了一张谁拿了多少的公开地图。",
    problemPanelIndex: "今天公众能推断出什么",
    problemPanelTitle: "标准空投通常暴露的信息远超活动本意。",
    problemItem1: "谁拿到了最大的份额。",
    problemItem2: "项目如何优先对待贡献者、投资人或合作伙伴。",
    problemItem3: "哪些受益人成为明显的钓鱼和 doxxing 目标。",
    solutionPanelIndex: "ZamaDrop 改变了什么",
    solutionPanelTitle: "让活动继续公开，让个人分配继续私密。",
    solutionPanelCopy:
      "ZamaDrop 不替代 Merkle eligibility。它是在公开活动透明度之上，再叠加一层由 Zama Fully Homomorphic Encryption 提供的机密层。",
    flowKicker: "工作方式",
    flowTitle: "一个简单流程，比拥挤概念图更有说服力。",
    flowCopy: "配置。解密。验证。",
    flowStep1Label: "步骤 01 / Admin",
    flowStep1Title: "配置活动，并声明公开规则。",
    flowStep1Item1: "设置总分发量、受益人数和活动状态。",
    flowStep1Item2: "声明公开的分配区间和活动约束。",
    flowStep1Item3: "提交加密后的个人分配，而不暴露精确金额。",
    flowStep2Label: "步骤 02 / Recipient",
    flowStep2Title: "只解密自己的分配，并完成领取。",
    flowStep2Item1: "通过 Merkle 路径证明资格。",
    flowStep2Item2: "借助 Zama 的能力完成单个个人分配的解密。",
    flowStep2Item3: "在不向整个活动公开金额的前提下完成领取。",
    flowStep3Label: "步骤 03 / Public + Auditor",
    flowStep3Title: "验证进度与聚合领取总额。",
    flowStep3Item1: "Public 看到总量、规则、人数、状态和进度。",
    flowStep3Item2: "Auditor 只检查聚合后的已领取总额。",
    flowStep3Item3: "除 Recipient 外，没有任何角色可以查看个人分配数值。",
    previewKicker: "产品预览",
    previewTitle: "三个简单界面。",
    previewCopy: "Admin、Recipient、公开进度，各自清楚。",
    preview1Tag: "Admin 视图",
    preview1Title: "公开总量，隐藏个人金额的活动配置面板。",
    preview1Copy:
      "Admin 决定哪些活动信息应该公开，同时让具体分配数据保持机密。",
    preview2Tag: "Recipient 视图",
    preview2Title: "一个人，只看到自己的一笔分配。",
    preview2Copy:
      "Recipient 只解密并领取自己的金额，不需要浏览整个活动的他人数据。",
    preview3Tag: "公开进度",
    preview3Title: "公开显示进度，但不暴露受益人。",
    preview3Copy:
      "观察者可以跟踪活动状态和聚合进度，而不会把整个空投变成个人分配排行榜。",
    ctaKicker: "最后一段",
    ctaTitle: "发起公开活动，不必公开每个人的数字。",
    ctaCopy: "活动公开问责，个人分配私密可控。",
    ctaButton: "回到顶部",
    footerCopy:
      "Powered by Zama Protocol。Merkle 证明谁能领，ZamaDrop 保护领多少。",
    footerLink1: "信任",
    footerLink2: "流程",
    footerLink3: "预览",
  },
};

const LP_STYLES = `
[data-lp-root] {
  --section-gap: clamp(72px, 10vw, 132px);
  --easing: cubic-bezier(0.22, 1, 0.36, 1);
}

[data-lp-root] .page-shell {
  position: relative;
  isolation: isolate;
}

[data-lp-root] .fluid-layer {
  position: fixed;
  inset: -12vh -12vw;
  pointer-events: none;
  z-index: -2;
  filter: blur(54px) saturate(112%);
  opacity: 0.92;
}

[data-lp-root] .orb {
  position: absolute;
  border-radius: 999px;
  mix-blend-mode: plus-lighter;
  animation: lp-drift 18s var(--easing) infinite alternate;
}

[data-lp-root] .orb-a {
  width: 44vw;
  height: 44vw;
  min-width: 360px;
  min-height: 360px;
  left: -8vw;
  top: -8vh;
  background: radial-gradient(circle, var(--color-lp-glow-a), transparent 68%);
}

[data-lp-root] .orb-b {
  width: 36vw;
  height: 36vw;
  min-width: 280px;
  min-height: 280px;
  right: -2vw;
  top: 12vh;
  background: radial-gradient(circle, var(--color-lp-glow-b), transparent 70%);
  animation-duration: 22s;
}

[data-lp-root] .orb-c {
  width: 28vw;
  height: 28vw;
  min-width: 240px;
  min-height: 240px;
  left: 48vw;
  bottom: 2vh;
  background: radial-gradient(circle, var(--color-lp-glow-c), transparent 72%);
  animation-duration: 20s;
}

@keyframes lp-drift {
  from { transform: translate3d(-1.5%, -1%, 0) scale(0.98); }
  to { transform: translate3d(2%, 2.2%, 0) scale(1.06); }
}

[data-lp-root] .lp-bg {
  position: fixed;
  inset: 0;
  z-index: -3;
  pointer-events: none;
  background:
    radial-gradient(circle at 20% 20%, var(--color-lp-glow-a), transparent 30%),
    radial-gradient(circle at 78% 18%, var(--color-lp-glow-b), transparent 32%),
    radial-gradient(circle at 70% 78%, var(--color-lp-glow-c), transparent 28%),
    var(--color-lp-bg);
}

[data-lp-root] .lp-noise {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: -3;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.45'/%3E%3C/svg%3E");
  opacity: 0.035;
  mix-blend-mode: soft-light;
}

[data-lp-root] {
  scroll-behavior: smooth;
  color: var(--color-lp-fg);
  font-family: var(--font-lp-body);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

[data-lp-root] a {
  color: inherit;
  text-decoration: none;
}

[data-lp-root] button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}

[data-lp-root] *,
[data-lp-root] *::before,
[data-lp-root] *::after {
  box-sizing: border-box;
}

[data-lp-root] .container {
  width: min(calc(100% - 40px), var(--container-lp));
  margin: 0 auto;
}

[data-lp-root] .site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  backdrop-filter: blur(18px);
  background: color-mix(in oklch, var(--color-lp-bg) 78%, transparent);
  border-bottom: 1px solid transparent;
}

[data-lp-root] .header-inner {
  min-height: var(--header-lp-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

[data-lp-root] .brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

[data-lp-root] .brand-mark {
  width: 14px;
  height: 14px;
  background: var(--color-lp-accent);
  clip-path: polygon(0% 15%, 100% 15%, 100% 30%, 30% 85%, 100% 85%, 100% 100%, 0% 100%, 0% 85%, 70% 30%, 0% 30%);
  box-shadow: 0 0 20px color-mix(in oklch, var(--color-lp-accent) 60%, transparent);
  flex: 0 0 auto;
}

[data-lp-root] .brand-name {
  font-size: 1.1rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

[data-lp-root] .nav-cluster {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

[data-lp-root] .nav-links {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  color: var(--color-lp-muted);
  font-size: 0.94rem;
}

[data-lp-root] .nav-links a {
  position: relative;
  transition: color 180ms var(--easing);
}

[data-lp-root] .nav-links a::after {
  content: "";
  position: absolute;
  left: 0;
  bottom: -8px;
  width: 100%;
  height: 1px;
  transform: scaleX(0);
  transform-origin: left;
  background: color-mix(in oklch, var(--color-lp-accent) 82%, var(--color-lp-fg));
  transition: transform 220ms var(--easing);
}

[data-lp-root] .nav-links a:hover,
[data-lp-root] .nav-links a:focus-visible {
  color: var(--color-lp-fg);
}

[data-lp-root] .nav-links a:hover::after,
[data-lp-root] .nav-links a:focus-visible::after {
  transform: scaleX(1);
}

[data-lp-root] .header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

[data-lp-root] .pill-btn,
[data-lp-root] .cta-btn,
[data-lp-root] .ghost-btn {
  border-radius: 999px;
  transition:
    transform 180ms var(--easing),
    border-color 180ms var(--easing),
    background-color 180ms var(--easing),
    color 180ms var(--easing),
    box-shadow 220ms var(--easing);
  will-change: transform;
}

[data-lp-root] .pill-btn {
  min-width: 48px;
  padding: 11px 14px;
  border: 1px solid var(--color-lp-border);
  background: color-mix(in oklch, var(--color-lp-surface) 72%, transparent);
  color: var(--color-lp-muted);
  box-shadow: inset 0 1px 0 oklch(100% 0 0 / 0.06);
}

[data-lp-root] .pill-btn:hover,
[data-lp-root] .pill-btn:focus-visible,
[data-lp-root] .ghost-btn:hover,
[data-lp-root] .ghost-btn:focus-visible,
[data-lp-root] .cta-btn:hover,
[data-lp-root] .cta-btn:focus-visible {
  transform: translateY(-1px);
}

[data-lp-root] .pill-btn.is-active {
  color: var(--color-lp-fg);
  border-color: color-mix(in oklch, var(--color-lp-accent) 34%, var(--color-lp-border));
  background: color-mix(in oklch, var(--color-lp-accent-soft) 58%, var(--color-lp-surface));
}

[data-lp-root] .hero {
  padding: clamp(80px, 12vw, 160px) 0 60px;
}

[data-lp-root] .hero-grid {
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: 64px;
  align-items: center;
  text-align: left;
}

[data-lp-root] .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklch, var(--color-lp-accent) 24%, var(--color-lp-border));
  background: color-mix(in oklch, var(--color-lp-surface) 62%, transparent);
  color: var(--color-lp-muted);
  font-size: 0.8rem;
  letter-spacing: 0.01em;
  margin-bottom: 22px;
}

[data-lp-root] .eyebrow-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-lp-accent);
  box-shadow: 0 0 18px color-mix(in oklch, var(--color-lp-accent) 55%, transparent);
}

[data-lp-root] h1,
[data-lp-root] h2,
[data-lp-root] h3 {
  margin: 0;
  font-family: var(--font-lp-display);
  letter-spacing: -0.045em;
  text-wrap: balance;
}

[data-lp-root] .hero-title {
  font-size: clamp(3.4rem, 6vw, 5.8rem);
  line-height: 0.92;
  max-width: 12ch;
  margin-inline: 0;
}

[data-lp-root] .hero-title .accent {
  color: var(--color-lp-accent);
}

[data-lp-root] .hero-copy {
  margin-top: 24px;
  max-width: 44ch;
  color: var(--color-lp-muted);
  font-size: clamp(1.05rem, 1.4vw, 1.18rem);
  line-height: 1.6;
  text-wrap: pretty;
  margin-inline: 0;
}

[data-lp-root] .hero-actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 36px;
  justify-content: flex-start;
}

[data-lp-root] .cta-btn,
[data-lp-root] .ghost-btn {
  padding: 14px 20px;
  font-weight: 600;
  font-size: 0.96rem;
  border: 1px solid transparent;
}

[data-lp-root] .cta-btn {
  background: var(--color-lp-fg);
  color: var(--color-lp-bg);
  box-shadow: 0 12px 30px color-mix(in oklch, var(--color-lp-fg) 12%, transparent);
}

[data-lp-root] .ghost-btn {
  border-color: var(--color-lp-border);
  color: var(--color-lp-fg);
  background: color-mix(in oklch, var(--color-lp-surface) 76%, transparent);
}

[data-lp-root] .hero-proof {
  padding: 32px;
  border-radius: var(--radius-lp);
  border: 1px solid color-mix(in oklch, var(--color-lp-accent) 20%, var(--color-lp-border));
  background: 
    linear-gradient(165deg, color-mix(in oklch, var(--color-lp-surface-strong) 94%, transparent), color-mix(in oklch, var(--color-lp-surface) 96%, transparent));
  box-shadow: 
    0 30px 60px oklch(0% 0 0 / 0.04),
    inset 0 1px 0 oklch(100% 0 0 / 0.1);
  overflow: hidden;
  position: relative;
  width: 100%;
}

[data-lp-root] .hero-proof::before {
  content: "";
  position: absolute;
  top: -20%;
  right: -10%;
  width: 120px;
  height: 120px;
  background: var(--color-lp-accent);
  opacity: 0.05;
  filter: blur(40px);
}

[data-lp-root] .proof-label {
  position: relative;
  color: var(--color-lp-muted);
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

[data-lp-root] .proof-title {
  position: relative;
  margin-top: 18px;
  font-size: 1.48rem;
  line-height: 1.1;
}

[data-lp-root] .proof-list {
  position: relative;
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 12px;
}

[data-lp-root] .proof-list li {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 12px;
  align-items: start;
  color: var(--color-lp-muted);
  line-height: 1.55;
}

[data-lp-root] .proof-list li::before {
  content: "";
  width: 8px;
  height: 8px;
  margin-top: 0.42rem;
  border-radius: 999px;
  background: var(--color-lp-accent);
  box-shadow: 0 0 16px color-mix(in oklch, var(--color-lp-accent) 55%, transparent);
}

[data-lp-root] .section {
  padding: var(--section-gap) 0 0;
  scroll-margin-top: calc(var(--header-lp-height) + 18px);
}

[data-lp-root] .section-head {
  display: grid;
  gap: 12px;
  max-width: 640px;
  margin: 0 auto 28px;
  text-align: center;
}

[data-lp-root] .kicker {
  color: var(--color-lp-accent);
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

[data-lp-root] .section-head h2 {
  font-size: clamp(2rem, 4vw, 3.25rem);
  line-height: 0.98;
}

[data-lp-root] .section-head p {
  margin: 0;
  color: var(--color-lp-muted);
  font-size: 1rem;
  line-height: 1.62;
  max-width: 48ch;
  margin-inline: auto;
}

[data-lp-root] .stats-grid,
[data-lp-root] .preview-grid {
  display: grid;
  gap: 18px;
}

[data-lp-root] .stats-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

[data-lp-root] .card {
  position: relative;
  border: 1px solid var(--color-lp-border);
  border-radius: var(--radius-lp);
  background: color-mix(in oklch, var(--color-lp-surface) 78%, transparent);
  box-shadow: var(--shadow-lp);
  overflow: hidden;
}

[data-lp-root] .stat-card {
  padding: 32px 28px;
  min-height: 220px;
  transition: transform 220ms var(--easing), border-color 220ms var(--easing);
}

[data-lp-root] .stat-card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in oklch, var(--color-lp-accent) 40%, var(--color-lp-border));
}

[data-lp-root] .stat-card::before,
[data-lp-root] .preview-card::before,
[data-lp-root] .problem-panel::before,
[data-lp-root] .flow-card::before,
[data-lp-root] .cta-panel::before {
  content: "";
  position: absolute;
  inset: auto auto 0 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, var(--color-lp-accent), transparent);
  opacity: 0.6;
}

[data-lp-root] .stat-index,
[data-lp-root] .preview-tag,
[data-lp-root] .flow-step-label {
  color: var(--color-lp-accent);
  font-family: var(--font-lp-mono);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

[data-lp-root] .stat-value {
  margin-top: 12px;
  font-size: clamp(2.2rem, 4vw, 3.2rem);
  line-height: 0.9;
  font-weight: 800;
  letter-spacing: -0.06em;
  color: var(--color-lp-fg);
}

[data-lp-root] .stat-card h3,
[data-lp-root] .problem-panel h3,
[data-lp-root] .preview-card h3 {
  margin-top: 16px;
  font-size: 1.25rem;
  line-height: 1.1;
  font-weight: 700;
}

[data-lp-root] .stat-card p,
[data-lp-root] .problem-panel p,
[data-lp-root] .preview-card p,
[data-lp-root] .flow-card p,
[data-lp-root] .cta-panel p,
[data-lp-root] .footer-copy {
  margin: 14px 0 0;
  color: var(--color-lp-muted);
  line-height: 1.6;
  font-size: 0.96rem;
  text-wrap: pretty;
}

[data-lp-root] .problem-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: stretch;
}

[data-lp-root] .problem-panel {
  padding: 34px 30px;
}

[data-lp-root] .exposure-list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 14px;
  color: var(--color-lp-muted);
}

[data-lp-root] .exposure-list li {
  padding-top: 14px;
  border-top: 1px solid color-mix(in oklch, var(--color-lp-border) 60%, transparent);
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

[data-lp-root] .exposure-list li::before {
  content: "→";
  color: var(--color-lp-accent);
  font-weight: bold;
}

[data-lp-root] .flow-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

[data-lp-root] .flow-card {
  padding: 32px 26px;
  min-height: 240px;
}

[data-lp-root] .flow-card h3 {
  margin-top: 18px;
  font-size: 1.2rem;
  line-height: 1.1;
  font-weight: 700;
}

[data-lp-root] .flow-card ul {
  margin: 18px 0 0;
  padding-left: 0;
  list-style: none;
  color: var(--color-lp-muted);
  line-height: 1.5;
  display: grid;
  gap: 10px;
}

[data-lp-root] .flow-card li {
  position: relative;
  padding-left: 18px;
}

[data-lp-root] .flow-card li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.6em;
  width: 6px;
  height: 6px;
  background: var(--color-lp-accent);
  border-radius: 1px;
}

[data-lp-root] .preview-grid {
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  align-items: stretch;
}

[data-lp-root] .preview-card {
  padding: 28px;
  min-height: 380px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

[data-lp-root] .preview-frame {
  flex: 0 0 200px;
  border-radius: var(--radius-lp-sm);
  border: 1px solid var(--color-lp-border);
  background: 
    linear-gradient(180deg, color-mix(in oklch, var(--color-lp-surface-strong) 92%, transparent), var(--color-lp-surface));
  box-shadow: inset 0 1px 2px oklch(0% 0 0 / 0.05);
  padding: 20px;
  display: grid;
  gap: 14px;
  overflow: hidden;
  position: relative;
}

[data-lp-root] .frame-bar,
[data-lp-root] .frame-chip,
[data-lp-root] .frame-line,
[data-lp-root] .frame-pill,
[data-lp-root] .frame-meter,
[data-lp-root] .frame-progress {
  border-radius: 4px;
  background: color-mix(in oklch, var(--color-lp-border) 60%, transparent);
}

[data-lp-root] .frame-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

[data-lp-root] .frame-bar {
  width: 60px;
  height: 6px;
}

[data-lp-root] .frame-chip {
  width: 48px;
  height: 20px;
  background: var(--color-lp-accent-soft);
  border: 1px solid color-mix(in oklch, var(--color-lp-accent) 20%, transparent);
}

[data-lp-root] .frame-metric {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  padding: 16px;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-lp-surface-strong) 80%, transparent);
  border: 1px solid var(--color-lp-border);
}

[data-lp-root] .frame-line {
  height: 8px;
  margin-top: 6px;
}

[data-lp-root] .frame-line.wide { width: 100%; }
[data-lp-root] .frame-line.mid { width: 70%; }
[data-lp-root] .frame-line.short { width: 40%; }

[data-lp-root] .frame-pill {
  width: 100%;
  height: 32px;
  background: var(--color-lp-accent);
  color: var(--color-lp-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

[data-lp-root] .frame-meter {
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: 
    radial-gradient(circle at 50% 50%, transparent 50%, color-mix(in oklch, var(--color-lp-border) 40%, transparent) 51%),
    conic-gradient(var(--color-lp-accent) 0% 70%, transparent 70% 100%);
}

[data-lp-root] .frame-progress {
  height: 8px;
  position: relative;
  background: color-mix(in oklch, var(--color-lp-border) 40%, transparent);
}

[data-lp-root] .frame-progress::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 65%;
  background: var(--color-lp-accent);
  border-radius: inherit;
}

[data-lp-root] .frame-rows {
  display: grid;
  gap: 10px;
}

[data-lp-root] .frame-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;
}

[data-lp-root] .frame-row .frame-line {
  margin-top: 0;
}

[data-lp-root] .frame-row .frame-chip {
  width: 44px;
  height: 18px;
  background: color-mix(in oklch, var(--color-lp-border) 68%, transparent);
  border: 0;
}

[data-lp-root] .cta-section {
  padding-bottom: var(--section-gap);
}

[data-lp-root] .cta-panel {
  padding: clamp(28px, 6vw, 42px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 22px;
  align-items: center;
}

[data-lp-root] .cta-panel h2 {
  font-size: clamp(2.1rem, 4vw, 3.2rem);
  line-height: 0.98;
}

[data-lp-root] .footer {
  padding: 0 0 34px;
}

[data-lp-root] .footer-inner {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  align-items: center;
  justify-content: space-between;
  padding-top: 24px;
  border-top: 1px solid color-mix(in oklch, var(--color-lp-border) 82%, transparent);
}

[data-lp-root] .footer-links {
  display: flex;
  align-items: center;
  gap: 20px;
  color: var(--color-lp-muted);
  font-size: 0.94rem;
  flex-wrap: wrap;
}

[data-lp-root] .footer-links a:hover,
[data-lp-root] .footer-links a:focus-visible {
  color: var(--color-lp-fg);
}

@media (max-width: 1040px) {
  [data-lp-root] .hero-grid,
  [data-lp-root] .problem-layout,
  [data-lp-root] .preview-grid,
  [data-lp-root] .cta-panel {
    grid-template-columns: 1fr;
  }

  [data-lp-root] .stats-grid,
  [data-lp-root] .flow-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  [data-lp-root] .header-inner,
  [data-lp-root] .nav-cluster {
    align-items: flex-start;
  }

  [data-lp-root] .header-inner {
    flex-direction: column;
    padding: 16px 0;
  }

  [data-lp-root] .nav-cluster {
    width: 100%;
    justify-content: space-between;
  }

  [data-lp-root] .nav-links {
    gap: 14px;
    font-size: 0.9rem;
  }

  [data-lp-root] .header-actions {
    margin-left: auto;
  }

  [data-lp-root] .hero {
    padding-top: 44px;
  }

  [data-lp-root] .container {
    width: min(calc(100% - 28px), var(--container-lp));
  }

  [data-lp-root] .cta-btn,
  [data-lp-root] .ghost-btn,
  [data-lp-root] .pill-btn {
    width: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-lp-root] {
    scroll-behavior: auto;
  }
}
`;

export function LandingPage(props: { onEnterCampaign: () => void }): JSX.Element {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const saved = window.localStorage.getItem("zamadrop:v2:lang");
    return saved === "zh" ? "zh" : "en";
  });
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("zamadrop:v2:theme");
    return saved === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    window.localStorage.setItem("zamadrop:v2:theme", theme);
    return () => {
      root.removeAttribute("data-theme");
    };
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const previousLang = root.getAttribute("lang");
    root.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    window.localStorage.setItem("zamadrop:v2:lang", lang);
    return () => {
      if (previousLang) {
        root.setAttribute("lang", previousLang);
      }
    };
  }, [lang]);

  const t = (key: string): string => dict[lang][key] ?? key;

  return (
    <div data-lp-root>
      <style>{LP_STYLES}</style>
      <div className="lp-bg" aria-hidden="true" />
      <div className="lp-noise" aria-hidden="true" />
      <div className="page-shell">
        <div className="fluid-layer" aria-hidden="true">
          <div className="orb orb-a"></div>
          <div className="orb orb-b"></div>
          <div className="orb orb-c"></div>
        </div>

        <header className="site-header">
          <div className="container header-inner">
            <a className="brand-lockup" href="#top" aria-label="ZamaDrop">
              <span className="brand-mark"></span>
              <span className="brand-name">ZamaDrop</span>
            </a>

            <div className="nav-cluster">
              <nav className="nav-links" aria-label="Primary">
                <a href="#proof">{t("navProof")}</a>
                <a href="#problem">{t("navProblem")}</a>
                <a href="#flow">{t("navFlow")}</a>
                <a href="#preview">{t("navPreview")}</a>
                <a
                  href="/campaign"
                  onClick={(event) => {
                    event.preventDefault();
                    props.onEnterCampaign();
                  }}
                >
                  {t("openDapp")}
                </a>
              </nav>

              <div className="header-actions" aria-label="Display controls">
                <button
                  className="pill-btn is-active"
                  type="button"
                  aria-label="Toggle language"
                  onClick={() => setLang(lang === "zh" ? "en" : "zh")}
                >
                  {lang === "zh" ? "中文" : "EN"}
                </button>
                <button
                  className="pill-btn is-active"
                  type="button"
                  aria-label="Toggle theme"
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                >
                  {theme === "dark" ? "Dark" : "Light"}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main id="top">
          <section className="hero">
            <div className="container hero-grid">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-dot"></span>
                  <span>{t("eyebrow")}</span>
                </div>

                <h1 className="hero-title" data-od-id="hero-headline">
                  <span>{t("heroTitleA")}</span>
                  <br />
                  <span className="accent">{t("heroTitleB")}</span>
                </h1>

                <p className="hero-copy" data-od-id="hero-copy">
                  {t("heroCopy")}
                </p>

                <div className="hero-actions">
                  <a className="cta-btn" href="#preview">
                    {t("heroCtaPrimary")}
                  </a>
                  <a className="ghost-btn" href="#flow">
                    {t("heroCtaSecondary")}
                  </a>
                </div>
              </div>

              <aside className="hero-proof" data-od-id="hero-proof">
                <div className="proof-label">{t("proofLabel")}</div>
                <h2 className="proof-title">{t("proofTitle")}</h2>
                <ul className="proof-list">
                  <li>{t("proofItem1")}</li>
                  <li>{t("proofItem2")}</li>
                  <li>{t("proofItem3")}</li>
                </ul>
              </aside>
            </div>
          </section>

          <section className="section" id="proof">
            <div className="container">
              <div className="section-head">
                <div className="kicker">{t("statsKicker")}</div>
                <h2>{t("statsTitle")}</h2>
                <p>{t("statsCopy")}</p>
              </div>

              <div className="stats-grid" data-od-id="stats-grid">
                <article className="card stat-card">
                  <div className="stat-index">{t("stat1Index")}</div>
                  <div className="stat-value">{t("stat1Value")}</div>
                  <h3>{t("stat1Title")}</h3>
                  <p>{t("stat1Copy")}</p>
                </article>

                <article className="card stat-card">
                  <div className="stat-index">{t("stat2Index")}</div>
                  <div className="stat-value">{t("stat2Value")}</div>
                  <h3>{t("stat2Title")}</h3>
                  <p>{t("stat2Copy")}</p>
                </article>

                <article className="card stat-card">
                  <div className="stat-index">{t("stat3Index")}</div>
                  <div className="stat-value">{t("stat3Value")}</div>
                  <h3>{t("stat3Title")}</h3>
                  <p>{t("stat3Copy")}</p>
                </article>
              </div>
            </div>
          </section>

          <section className="section" id="problem">
            <div className="container">
              <div className="section-head">
                <div className="kicker">{t("problemKicker")}</div>
                <h2>{t("problemTitle")}</h2>
                <p>{t("problemCopy")}</p>
              </div>

              <div className="problem-layout">
                <article className="card problem-panel">
                  <div className="stat-index">{t("problemPanelIndex")}</div>
                  <h3>{t("problemPanelTitle")}</h3>
                  <ul className="exposure-list">
                    <li>{t("problemItem1")}</li>
                    <li>{t("problemItem2")}</li>
                    <li>{t("problemItem3")}</li>
                  </ul>
                </article>

                <article className="card problem-panel">
                  <div className="stat-index">{t("solutionPanelIndex")}</div>
                  <h3>{t("solutionPanelTitle")}</h3>
                  <p>{t("solutionPanelCopy")}</p>
                </article>
              </div>
            </div>
          </section>

          <section className="section" id="flow">
            <div className="container">
              <div className="section-head">
                <div className="kicker">{t("flowKicker")}</div>
                <h2>{t("flowTitle")}</h2>
                <p>{t("flowCopy")}</p>
              </div>

              <div className="flow-grid" data-od-id="flow-grid">
                <article className="card flow-card">
                  <div className="flow-step-label">{t("flowStep1Label")}</div>
                  <h3>{t("flowStep1Title")}</h3>
                  <ul>
                    <li>{t("flowStep1Item1")}</li>
                    <li>{t("flowStep1Item2")}</li>
                    <li>{t("flowStep1Item3")}</li>
                  </ul>
                </article>

                <article className="card flow-card">
                  <div className="flow-step-label">{t("flowStep2Label")}</div>
                  <h3>{t("flowStep2Title")}</h3>
                  <ul>
                    <li>{t("flowStep2Item1")}</li>
                    <li>{t("flowStep2Item2")}</li>
                    <li>{t("flowStep2Item3")}</li>
                  </ul>
                </article>

                <article className="card flow-card">
                  <div className="flow-step-label">{t("flowStep3Label")}</div>
                  <h3>{t("flowStep3Title")}</h3>
                  <ul>
                    <li>{t("flowStep3Item1")}</li>
                    <li>{t("flowStep3Item2")}</li>
                    <li>{t("flowStep3Item3")}</li>
                  </ul>
                </article>
              </div>
            </div>
          </section>

          <section className="section" id="preview">
            <div className="container">
              <div className="section-head">
                <div className="kicker">{t("previewKicker")}</div>
                <h2>{t("previewTitle")}</h2>
                <p>{t("previewCopy")}</p>
              </div>

              <div className="preview-grid" data-od-id="preview-grid">
                <article className="card preview-card">
                  <div className="preview-tag">{t("preview1Tag")}</div>
                  <div className="preview-frame" aria-hidden="true">
                    <div className="frame-top">
                      <div className="frame-bar"></div>
                      <div className="frame-chip"></div>
                    </div>
                    <div className="frame-metric">
                      <div>
                        <div className="frame-line wide"></div>
                        <div className="frame-line short"></div>
                      </div>
                      <div className="frame-meter"></div>
                    </div>
                    <div className="frame-progress"></div>
                    <div className="frame-rows">
                      <div className="frame-row">
                        <div className="frame-line wide"></div>
                        <div className="frame-chip"></div>
                      </div>
                      <div className="frame-row">
                        <div className="frame-line mid"></div>
                        <div className="frame-chip"></div>
                      </div>
                    </div>
                  </div>
                  <h3>{t("preview1Title")}</h3>
                  <p>{t("preview1Copy")}</p>
                </article>

                <article className="card preview-card">
                  <div className="preview-tag">{t("preview2Tag")}</div>
                  <div className="preview-frame" aria-hidden="true">
                    <div className="frame-top">
                      <div className="frame-bar"></div>
                      <div className="frame-chip"></div>
                    </div>
                    <div className="frame-metric">
                      <div>
                        <div className="frame-line mid"></div>
                        <div className="frame-line short"></div>
                      </div>
                      <div className="frame-pill"></div>
                    </div>
                    <div className="frame-line wide"></div>
                    <div className="frame-line mid"></div>
                    <div className="frame-pill"></div>
                  </div>
                  <h3>{t("preview2Title")}</h3>
                  <p>{t("preview2Copy")}</p>
                </article>

                <article className="card preview-card">
                  <div className="preview-tag">{t("preview3Tag")}</div>
                  <div className="preview-frame" aria-hidden="true">
                    <div className="frame-top">
                      <div className="frame-bar"></div>
                      <div className="frame-chip"></div>
                    </div>
                    <div className="frame-line wide"></div>
                    <div className="frame-progress"></div>
                    <div className="frame-rows">
                      <div className="frame-row">
                        <div className="frame-line wide"></div>
                        <div className="frame-chip"></div>
                      </div>
                      <div className="frame-row">
                        <div className="frame-line mid"></div>
                        <div className="frame-chip"></div>
                      </div>
                      <div className="frame-row">
                        <div className="frame-line short"></div>
                        <div className="frame-chip"></div>
                      </div>
                    </div>
                  </div>
                  <h3>{t("preview3Title")}</h3>
                  <p>{t("preview3Copy")}</p>
                </article>
              </div>
            </div>
          </section>

          <section className="section cta-section">
            <div className="container">
              <div className="card cta-panel">
                <div>
                  <div className="kicker">{t("ctaKicker")}</div>
                  <h2>{t("ctaTitle")}</h2>
                  <p>{t("ctaCopy")}</p>
                </div>
                <a className="cta-btn" href="#top">
                  {t("ctaButton")}
                </a>
              </div>
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="container footer-inner">
            <div className="footer-copy">{t("footerCopy")}</div>
            <nav className="footer-links" aria-label="Footer">
              <a href="#proof">{t("footerLink1")}</a>
              <a href="#flow">{t("footerLink2")}</a>
              <a href="#preview">{t("footerLink3")}</a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
