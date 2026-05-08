## Context

ZamaDrop V6 已经把 KMS-hardened settlement 跑通(`FHE.checkSignatures` 在 `callbackFinalize` / `executeTransfer` 里防 caller 伪造金额),合约层签名校验是 production-ready 的(V7 起前端钱包主动 pull + 自提交,见 [ADR 0003](../../../docs/ADR/0003-frontend-as-primary-executor.md))。但产品形态停在"工程脚手架"层面 —— `frontend/src/config.ts` 硬编码 campaign 地址,Admin 想发新空投必须打开终端跑 `scripts/cli-setup.ts`。

V7 的目标是把 ZamaDrop 推到"真产品"形态,**同时**把 4 轮 Codex 对抗 review 找到的 9 处合约层 bug 一次还清。这里有一个关键的设计杠杆:**通过让 Admin 钱包直接部署合约(浏览器内 wizard,而不是新加 Factory 合约)**,我们既得到完整的产品体验,又规避了 Factory 引入的 admin = msg.sender 错位 bug —— 钱包就是 EOA / Safe / AA 钱包,直接 CREATE 合约,`msg.sender` 就是钱包本身。

约束:
- fhEVM 当前只在 Sepolia / 本地 hardhat 跑,生产 KMS 是 permissioned operator set,这是协议层的信任假设
- 项目此前 `openspec/specs/` 为空,本 change 是首批 capability 落盘
- 单 token 锁定 ZDT(`MockToken.sol` decimals=0),uint64 单笔上限 1.8×10^19 base unit 完全够用,**不引入 euint128 改造**
- recipientCount 在 V6 是装饰品(没人 check),V7 必须把它绑死 —— 否则 Codex 揪出的"audit 假对账"无法关闭

## Goals / Non-Goals

**Goals:**
- Admin 在浏览器内完整完成 campaign 创建到上链的全流程,无需打开终端
- Recipient 连钱包后通过 SIWE 自查能领取的 campaign,零学习成本
- Auditor 拿到 settlement integrity + solvency invariant 的可独立验证视图
- 9 处 Codex 必修 bug 全部封闭,合约具备上 mainnet 的安全性
- 隐私边界对外表述跟链上现实一致,不打"membership privacy"这种打不出去的牌
- 草稿数据后端永不可见明文金额(envelope 加密)

**Non-Goals:**
- 不加 Factory 合约(wizard 直接钱包部署已解决 Admin acquisition,Factory 反而引入新攻击面)
- 不升级到 euint128(ZDT decimals=0 + uint64 已经能表示 1.8×10^19 个 token,够用)
- 不做 multi-token / token selector(写死 ZDT 一种,V8+ 再开)
- 不做 membership privacy(需要重写合约 + commitments/nullifiers/Merkle,4-6 周工程,V8+)
- 不做 pause / cancel / time-lock / 批量 setAllocation
- 不做 Safe / EIP-4337 原生支持(支持 EOA wizard 部署即可,Safe 用户走 Safe UI 自己签)

## Decisions

### Decision 1: Admin 入口 = wizard 直接钱包部署(不加 Factory)

Codex round 1 提出"Factory 合约会让 admin = Factory 而不是真人"。备选:
- **A) 加 Factory + 改合约 admin 通过 constructor 显式传入** — Codex round 1 推荐
- **B) 不加 Factory,但 wizard 在前端用 wallet 直接 CREATE 合约** — 选项

选 **B**,因为:
1. 钱包(EOA)直接 CREATE 时 `msg.sender = wallet`,自然就是 admin,不需要新合约
2. Factory 是新攻击面(谁能调 deploy?权限模型?升级?),MVP 内多余
3. PRD 明确把 multi-campaign factory 列在 out-of-scope

但 Codex round 4 进一步指出:**即使没 Factory,把 admin 从 `msg.sender` 改成 constructor 显式参数仍然必要** —— 因为 Safe / EIP-4337 / ERC-2771 等场景下 `msg.sender` 可能是 helper 而不是真人。所以最终设计是 **B + 显式 admin_ 参数**:wizard 用 EOA 直接部署是常态,但合约不依赖"deployer = admin"这个隐式假设。

### Decision 2: Token = 写死 ZDT,decimals=0

Codex round 4 提出 "euint64 + 18-decimal token = 单笔最大 18.44 个 token,demo 直接翻车"。备选:
- **A) 升级 euint128**(2-3 人天,合约 + 测试 + KMS ABI 改动)
- **B) MVP 锁定低 decimal token + 文档警示**
- **C) 引入 scaling 层** UI 把 18 decimal 缩到 6

发现项目已经有 `contracts/MockToken.sol` 且 `decimals() = 0`,选 **B**:
- ZDT decimals=0 + uint64 max ≈ 1.8×10^19 base unit,远超任何现实 demo 需求
- Codex round 4 揪出的 18-decimal 问题在 ZDT 上不存在
- V8+ 接真 confidential token (ERC-7984) 时再考虑 euint128

### Decision 3: Recipient 发现 = SIWE 鉴权 indexer + 诚实定位

Codex round 2 戳穿:`event AllocationSet(address indexed recipient)` 链上公开,任何人都能扫到全部 recipient 列表。所以"recipient 隐私"在合约层就不存在。

备选:
- **A) 不做 indexer,Recipient 必须 Admin 推 URL 才能进** — 用户体验差
- **B) 公开 indexer(任何人查任何地址的 campaign)** — 把链上"懂技术能扫"的泄漏放大成"任何人 1 秒可查"
- **C) SIWE 鉴权 indexer(只本人可查自己)** — 选项

选 **C**,但**对外表述必须诚实**:不是"隐私层",是**防滥用 + UX 层**。链上数据该泄漏的还泄漏,SIWE 只挡住"我们自己 API 被当成查询服务被滥用"。

### Decision 4: 草稿加密 = DEK + KEK 信封

Codex round 3 戳穿 naive "wallet 签固定消息派生 AES key" 三个问题:
- 钱包轮换 → 旧草稿全部解不开
- 一次钓鱼签名 → 历史 + 未来全部草稿暴露
- IV 重用 / 跨钱包不确定性

备选:
- **A) 后端存明文 + DB 加密** — DB 运维仍可见,跟"金额隐私"卖点矛盾
- **B) naive 单 key** — 上述三问题
- **C) DEK + KEK 信封加密 + 钱包派生 KEK + scope 防钓鱼** — 选项

选 **C**:
- 每草稿随机 DEK,加密金额数据
- KEK = SHA256(wallet.signMessage(scope)),scope 含 chainId / origin / admin / draftId / createdAt / purpose
- 钱包轮换:旧钱包解 KEK → 拿 DEK → 新钱包重 wrap KEK,数据不动
- 钓鱼防御:scope 里的 origin 让钓鱼站签出的 KEK 解不开真站草稿
- 每次保存生成 fresh AES-GCM IV,加 unit test 断言不重

### Decision 5: withdrawExcess 触发 = Option C(任何状态,只能取安全余额)

合约设计上,任何人都能往合约地址转 ERC-20(Admin 手滑双打 / 第三方乱转)。如果没有取回机制,多余 token 永久卡死。备选:

- **A) Admin 任何时候可取全部** — rug-pull 漏洞,Admin 可在 finalize 后清空合约,recipient 全 claim 失败
- **B) 仅 Setup 状态可取** — 防 rug-pull,但 Setup 后多打的钱永久卡死
- **C) 任何状态可取,但只能取 `balance - (declaredTotal - claimedTotalPlaintext)`** — 选项

选 **C**:
- 数学上保证 recipient 应得部分(stillOwed)永远不被动
- 多余 token 任何时候可清退
- Auditor 多了个可独立验证的 invariant:`balance >= declaredTotal - claimedTotalPlaintext`
- 工程量:1 个新 uint64 状态变量 + 1 个 ~10 行函数

**重要更正(Codex 第 5 轮 review 指出):** Option C 单独不能救回 finalize 失败场景的资金。当 `callbackFinalize(false)` 触发,`claimedTotalPlaintext = 0`,`stillOwed = declaredTotal`,`maxWithdraw = balance - stillOwed = 0`。Admin 钱锁死。所以本设计 PAIR Option C `withdrawExcess` (Claiming 状态用) WITH 新增的 `cancelCampaign()` 函数(Failed 状态用)。后者绕过 `stillOwed` 的数学约束,直接转出全部 balance,因为 `Failed` 状态下没有 recipient 应得部分。

### Decision 6: 实施步骤的"代码 vs 目标"分级

writing-plans 类工具默认要求"每步给完整代码",但**对现代 AI 执行 agent 过度,会限制其用项目上下文找更优实现路径**。备选:
- **A) 全部给代码**(传统 plan 写法)
- **B) 全部给目标**(完全交给 agent)
- **C) 分级:错了会爆给代码,错了能改给目标** — 选项

选 **C**,具体规则:
- 给代码:合约 ABI / state 字段、密码学协议、invariant 校验、DB schema、API 端点形状
- 给目标 + 验收 + 引用现有模式:UI 组件实现、路由 / 状态管理、API handler 内部逻辑、样式
- 理由:契约性强的地方代码本身就是规范;实现细节地方让 agent 用项目上下文做最佳选择(避免风格冲突 / 库版本错位 / 思维窒息)

### Decision 7: Out of MVP 的明确边界

明确推到 V8+(写进 SECURITY.md):
- Factory 合约
- euint128
- Multi-token / token selector
- Membership privacy(commitments / nullifiers / Merkle / stealth address)
- pause / cancel / time-lock / reclaim deadline
- 批量 setAllocation(N 笔单发可应付 demo 规模 ~50 recipient)
- Safe / EIP-4337 原生 SDK 集成

### Decision 8: 显式状态机替换 bool finalized

V6 合约用 `bool finalized` 跟踪状态。这个布尔值无法区分"Finalizing 中等 KMS callback"与"Failed(callback 返回 false)"两种状态。Codex 第 5 轮 review 戳穿:`finalized=false` 既可能是 Setup 也可能是 Failed,也可能是 Finalizing 等待回调。

**备选:**
- A) 保留 bool,组合 `finalizeCheckHandle != 0` 等隐式信号区分 — fragile
- B) 引入 `enum State { Setup, Finalizing, Claiming, Failed }` — 选项

选 **B**,理由:
- Codex 揪出的 5 个状态机相关 bug(finalize twice / setAllocation after finalize / claim before finalized / callbackFinalize false / callback retry)在 enum 下都能干净表达
- `Failed` 是终态,显式标记后 cancelCampaign 可安全只在该状态下生效
- 工程量增加 ~30 行(enum 定义 + 转换守卫),换来 spec 可测试性与防御深度

合约状态转换:
- `Setup` → `Finalizing`(由 `finalize()` 触发)
- `Finalizing` → `Claiming`(由 `callbackFinalize(true)` 触发)
- `Finalizing` → `Failed`(由 `callbackFinalize(false)` 触发)
- 任何其他状态调用 finalize / setAllocation / claim 一律 revert

## Risks / Trade-offs

- **跨 tab 编辑 listHash 漂移** → wizard Step 4-5 期间显示 banner "Snapshot locked",Step 5 启动前 L3 校验 draft.version 跟 snapshot.version 一致,不一致 BlockingError
- **Admin 钱包余额跨步骤变化** → wizard 持久化进度状态,Step 5 中段失败时草稿状态变 `failed_partial`,重进 wizard 从断点续行(已分配的 setAllocation 跳过)
- **Zama KMS 是 permissioned operator set** → 不是 ZamaDrop 自己引入的信任假设,SECURITY.md 明示这是协议级假设,V7 不主动解决
- **Recipient membership 全网公开** → 接受现状,homepage + SECURITY.md 诚实表述。V8+ 重塑事件层(commitments)再考虑
- **Claim 金额 claim 后明文广播**(`TokenTransferred(user, amount)` event)→ 跟 membership 泄漏同源,文档化为"allocation-at-rest privacy",不是"lifecycle privacy"
- **后端 indexer 中心化点** → DB 是缓存,链是真相;indexer 全挂时 dApp 退化但 campaign 仍可通过链上读写运行(单 campaign URL 可绕过 indexer)
- **DEK+KEK 跨设备需重新 wrap** → 用户用旧钱包先解 KEK,然后用新设备重 wrap。MVP 内 UX 还行,V8 可加自动 rewrap 流程
- **Wizard 47+ recipient 单笔上链 ~0.27 ETH gas** → MVP 接受单笔逐发,V8 加合约 batch 方法

### 12.1 失败 finalize 救援路径

如果 KMS 返回 `sumCheck=false`,合约进入 `Failed` 终态。recovery 路径:

1. wizard Step 5.5 检测到 KMS callback 返回 false → 显示明确错误屏
2. 错误屏引导 Admin 调用 `cancelCampaign()`(只在 `Failed` 状态可用,转回全部 balance)
3. Admin 重新走 wizard 部署一个新 campaign,使用更正后的输入

**重要:** Failed 状态不能走 `withdrawExcess`(数学上 maxWithdraw=0)。必须用 `cancelCampaign`。这是显式的设计选择,不是漏洞。

## Migration Plan

V6 → V7 是 breaking change(constructor 签名变更),不能就地升级:

1. **不下线 V6 部署的 campaign**:V6 合约继续在 Sepolia 上跑,V6 dApp 通过环境变量切换 V6/V7 ABI(或直接保留两套 ABI 双轨)
2. **新合约部署**:V7 dApp 默认部署新合约,所有新 campaign 走 V7 ABI
3. **回滚策略**:如果 V7 在 Sepolia 上发现关键 bug,前端环境变量 `VITE_DAPP_VERSION=v6` 切回 V6 静态 dApp,合约层无影响(V6 合约本来就独立部署)
4. **测试矩阵**:Phase 1 合约改造完成后必须跑 `npm test` + `npm run coverage`,coverage 阈值 90%;e2e Sepolia 跑过完整 wizard 流程才合并到 main
5. **commit 节奏**:每个 Phase 内每个 task 独立 commit(参考 tasks.md),保持每个 commit "compiles + all tests pass"

## Open Questions

(brainstorm 期间已收敛,无未决问题)

实施期间可能浮现的工程问题预期在 tasks.md 里以"acceptance criteria"形式锁定,具体实现技术选型(库版本、组件结构等)交给执行 agent 根据项目上下文决定。
