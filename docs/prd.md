# ZamaDrop — 产品需求文档

> **Private allocations. Public accountability.**

**赛事**: Zama Protocol Bounty — Confidential Onchain Finance | **截止**: 2026-05-10 23:59 AOE

---

## 1. 产品定位

**ZamaDrop** 是一个**机密代币分发协议**,让项目方在向社区发放代币时,既能让 **campaign 总量、人数、规则**完全公开可验证,又能让**每个受益人的具体分配金额**对外保密。它解决的是当前空投生态中一个被长期忽视的结构性缺陷——公开的 allocation list 同时是攻击者的**目标定位数据库**,导致大额受益人成为钓鱼、社工与长期 doxxing 的精准目标。

**核心承诺一句话**: *Merkle 空投验证「谁能领」,但泄露「领多少」。ZamaDrop 补上 allocation 隐私层。*

**主要客户**是准备进行 token launch 的协议方。**次要客户**是有 contributor grant 或 early backer allocation 需求的 DAO 与 Web3 创业公司。**明确不做**: 反女巫攻击、KYC 集成、vesting 解锁曲线、Merkle 资格验证(架构留位、MVP 不实现)。

---

## 2. 用户角色与场景

ZamaDrop 涉及四个角色,每个角色对应一个独立场景。**项目方 (Admin)** 负责创建 campaign、声明总量、为每个受益人配置加密 allocation、最终触发 finalize 让 campaign 进入领取阶段。**第三方观察者 (Public)** 是任何对 campaign 透明度感兴趣的人,能看到总量、人数、规则等聚合信息,但看不到任何个体金额。**受益人 (Recipient)** 通过钱包连接确认自己的 allocation,触发解密看到金额,完成领取。**审计员 (Auditor)** 由项目方明确授权,能解密 *已 claim 总额* 这类聚合统计,用于合规验证,但**仍然看不到任何个人 allocation**。

四个角色共同诠释 slogan 的字面含义——**campaign 级别透明,个人级别保密**,这两层在传统设计中被绑定,FHE 让它们第一次解耦。

---

## 3. 核心流程

整个 campaign 生命周期分三个阶段。

**Setup 阶段**: 项目方部署 campaign 容器、声明总分发量(明文公开)、把总量对应的代币锁入合约形成 escrow,然后逐个为受益人设置加密 allocation。每次设置都是一笔独立成功的链上承诺,无法被事后篡改。这一阶段任何受益人都**不能领取**,因为 campaign 状态尚未进入 Finalized。

**Finalize 阶段**: 所有 allocation 设置完毕后,项目方触发 finalize 操作。系统在密文状态下自动核对 *所有个体 allocation 之和* 与 *声明总量* 是否一致——这是密码学层面强制的总量对账,**项目方无法在密文掩护下偷偷克扣总额**。对账通过则 campaign 进入领取阶段;对账失败则 finalize 交易回滚,campaign 卡在 Setup 状态,但已写入的 allocation 数据完整保留,项目方可补救后重试。这一阶段的失败行为**永久公开记录**,社区可见,无法被项目方隐藏。

**Claim 阶段**: 受益人连接钱包,确认自己的密文 allocation,触发解密看到具体金额,签名完成领取交易。每次领取都会让授权 auditor 能解密的 *已 claim 总额* 累加器更新一次,使审计层面能够实时跟踪进度。

---

## 4. 关键差异化

ZamaDrop 在评分维度上的差异化集中在三处。

**Innovation**: 提出 *eligibility ≠ allocation privacy* 的精确缺口论断,既承认 Merkle proof 的价值又精确指出其设计盲区,这种 gap-analysis 框架避免了"全面替代现有方案"的过度宣称,可信度更高。

**Compliance awareness**: 通过 auditor 角色实现 *programmable compliance* 的具体形态——监管能拿到聚合维度的合规答案,但拿不到个人维度的隐私数据。这一点在 bounty 评分维度中作为独立项被列出,绝大多数参赛者会忽略,做了即结构性差异化。

**Real-world potential**: 同一个加密原语可扩展到 DAO 薪资发放、investor & contributor vesting、sealed contributor airdrops 三个相邻场景,共享底层合约组件,展示了**技术杠杆**——这对投资人型评委是关键信号。

---

## 5. 成功标准

**黑客松层面**: 命中 bounty 全部六项评分维度 (Innovation、Compliance awareness、Real-world potential、Technical implementation、Production readiness、Usability),进入获奖前 5 名。视频在前 30 秒抓住评委注意力、在最后 10 秒留下可被复述的 slogan 记忆点、在中段 demo 完成四视角对比。

**产品层面 (long-term, 非 MVP 范围)**: 协议成为 token launch 标准基础设施之一,被至少一个真实空投活动采用,处理超过 1,000 个 recipient 的实际分发。

**MVP 阶段只对黑客松层面的成功标准负责**,产品层面指标作为愿景陈述出现在 README 与视频结尾,不作为交付物。

---

## 6. 范围边界

MVP 必须交付的功能包括四个角色的完整流程闭环、campaign 创建与 finalize 的状态机、allocation 加密存储与 ACL 严格隔离、auditor 聚合视图、清晰的项目文档与 2 分钟真人出镜视频。

MVP 不包括的功能包括 vesting 线性解锁、Merkle proof 资格验证、多 campaign 工厂模式、CSV 批量导入、跨链桥接、移动端、KYC 集成、anti-Sybil 机制、复杂的 auditor 查询(如 sanctioned address 检测)。这些功能要么不影响视频呈现效果、要么实现复杂度超出 10 天工期、要么对 bounty 评分维度无直接贡献,统一作为 roadmap 一句话提及。

---


## 7. 提交清单

最终提交需包含可在测试网完整跑通四视角的 dApp、公开 GitHub 代码仓库、清晰的 README(含架构图、合约地址、部署步骤、技术亮点说明)、2 分钟真人出镜视频、中英双语字幕。视频中 slogan **"Private allocations. Public accountability."** 必须出现至少两次,auditor 视图必须至少出现 5 秒,所有旁白必须真人录制,**禁止任何 AI 合成语音或虚拟形象**。

---

## 8. Landing Page 视觉规范

Landing Page 已锁定 **v2 终稿**，详细规范见 [`docs/landing-page-spec.md`](./landing-page-spec.md)，原型保留在 [`docs/index_v2.html`](./index_v2.html) 作为视觉参考。**任何 Landing Page 视觉/文案变更必须先改 spec 文档**，再同步到 `frontend/src/pages/LandingPage.tsx`。

**核心要点**：

- **设计基调**：奶油底 + 金棕 accent（`oklch(63% 0.17 83)`），低饱和、协议级专业感、流动 orb 背景。
- **支持 Light + Dark 双主题** 与 **EN + 中文 双语**，由 `<html data-theme>` / `<html lang>` 切换，状态写入 `localStorage`。
- **信息架构（顺序固定）**：Hero → Trust signals (3 stat) → Problem vs Solution → Flow (3 step) → Product preview (3 mock UI) → Final CTA → Footer。
- **slogan 出现位置**：Hero 大标题（第一处）+ Footer slogan（第二处），满足视频以外的 slogan 复述要求。
- **不接钱包**：Landing Page 是营销层，所有 CTA 引导到 `/campaign`，由那里再分流到四个角色 tab。
- **不引入新依赖**：i18n 与 theme 用 `useState + localStorage` 60 行内实现，不装 i18next / next-themes / framer-motion。
- **响应式断点**：1040px（grid 折单列）/ 780px（header 折叠）。

实现位置：`frontend/src/pages/LandingPage.tsx`；token 配置：`frontend/src/index.css` 的 `@theme` 块。
