# admin-deployment-flow Specification

## Purpose
TBD - created by archiving change v7-dapp-wizard. Update Purpose after archive.
## Requirements
### Requirement: 5 步 wizard 创建 campaign

dApp SHALL 在 `/wizard/*` 路由下提供一个引导式的 5 步 wizard,允许 Admin 不依赖 CLI 即可创建新 campaign。5 步 SHALL 分别为:(1)Basics、(2)Recipients、(3)Auditor 与自动派生确认、(4)Review 与 snapshot 锁、(5)Deploy。

#### Scenario: Admin 走完整 wizard

- **WHEN** Admin 进入 `/wizard/basics`,逐步填完每一步,在 Step 4 点"Start Deploy",并在 Step 5 完成所有钱包签名
- **THEN** 一个新的 ZamaDropCampaign 合约 SHALL 被部署到链上,admin 等于 Admin 钱包地址
- **AND** wizard SHALL 显示完成屏,带可分享给 recipient 与 auditor 的 URL

#### Scenario: Admin 不可跳步

- **WHEN** Admin 在没有填 recipient 的情况下直接访问 `/wizard/review`
- **THEN** wizard SHALL 重定向或拦截用户(因为 `recipients.length === 0` 不通过 L2 校验)

### Requirement: Step 1 — Basics

Step 1 SHALL 收集 campaign 名称与可选描述。token 字段 SHALL 显示 ZDT(从 `VITE_TOKEN_ADDRESS` 读取)作为不可编辑的视觉确认,并显示连接钱包的 ZDT 余额。

#### Scenario: token 字段只读

- **WHEN** Admin 查看 Step 1
- **THEN** token 区域 SHALL 显示 "ZDT (ZamaDrop Test Token)"、合约地址、decimals=0、当前钱包余额
- **AND** SHALL NOT 存在允许 Admin 选择其他 token 的输入框

### Requirement: Step 2 — Recipients 与 L1+L2 校验

Step 2 SHALL 支持逐行输入或 CSV 粘贴录入收件人地址与金额。校验 SHALL 在每行实时进行(L1),并在切换到 Step 3 时对整张列表进行校验(L2)。

L1 SHALL 拒绝:
- 非法地址(非 `0x...` 也非 ENS `.eth`)
- 严格 uint64 解析失败的金额(拒绝逗号、指数、小数、负数、溢出)
- 金额等于 0

L2 SHALL 拒绝:
- 列表为空
- 总额为 0
- 总额超过当前钱包 ZDT 余额
- 重复的 recipient 地址

#### Scenario: L1 拒绝带逗号的金额

- **WHEN** Admin 输入 "0xALICE 5,000"(含逗号)
- **THEN** 该行 SHALL 实时被标记为非法
- **AND** 用户 SHALL 看到说明逗号不允许的错误信息

#### Scenario: L2 拦截余额不足

- **WHEN** recipient 总额为 1,000,000,而 Admin 钱包 ZDT 余额为 500,000
- **AND** Admin 点击"Next"
- **THEN** 进入 Step 3 SHALL 被阻断,显示明确的余额不足错误

### Requirement: Step 3 — 自动派生预算面板

Step 3 SHALL 只收集 auditor 地址。`recipientCount` 与 `declaredTotal` SHALL 自动从 Step 2 的列表派生,以只读面板展示。Admin SHALL NOT 被允许手填这两个值。

#### Scenario: 派生值与列表一致

- **WHEN** Step 2 有 47 个 recipient,合计 235,000
- **AND** Admin 进入 Step 3
- **THEN** 面板 SHALL 显示 "Recipient count: 47" 与 "Declared total: 235,000 ZDT"

#### Scenario: 编辑 Step 2 失效 Step 3 派生值

- **WHEN** Admin 从 Step 3 退回 Step 2 添加新 recipient
- **AND** 再次进入 Step 3
- **THEN** 派生面板 SHALL 反映新的合计与人数

### Requirement: Step 4 — Review 与 snapshot 锁

Step 4 SHALL 计算并锁定一个 snapshot,包含 `listHash = keccak256(abi.encode(addresses))`、`declaredTotal`、`recipientCount`、`capturedAt` 与 `draftVersion`。如果用户回到 Step 2 修改任何内容,`draftVersion` SHALL 自增,snapshot SHALL 失效,强制用户重新进入 Step 4。

Step 4 SHALL 同时显示按子步骤拆分的 gas 估算,并在"Start Deploy"按钮可点击之前要求显式勾选确认框。

#### Scenario: 进入 Step 4 时捕获 snapshot

- **WHEN** Admin 首次进入 `/wizard/review`
- **THEN** wizard SHALL 计算 `listHash` 并把 snapshot 写入 state

#### Scenario: 编辑后 snapshot 失效

- **WHEN** Admin 点击 recipient 区域的"Edit",修改列表后回到 Step 4
- **THEN** 之前 snapshot 的 `draftVersion` SHALL 不等于当前 version
- **AND** Step 5 SHALL 拒绝部署直至重新捕获 snapshot

### Requirement: Step 5 — 5 个上链子步骤

Step 5 SHALL 以 5 个用户可见的子步骤完成部署:(5.1)钱包直接部署合约;(5.2)`token.transfer` 把 `declaredTotal` ZDT 注入合约;(5.3)对每个 recipient 调用 `setAllocation`(客户端 FHE 加密);(5.4)调 `finalize()`;(5.5)等待 KMS callback 把 `finalized` 翻为 true。

每个子步骤 SHALL 实时更新可见进度。子步骤 5.3 SHALL 显示已分配的 recipient 数。每个上链动作 SHALL 是一次独立钱包签名。

#### Scenario: 钱包直接部署(无 Factory)

- **WHEN** 子步骤 5.1 执行
- **THEN** 部署交易 SHALL 由 Admin 钱包发出(`msg.sender = Admin EOA`)
- **AND** SHALL NOT 涉及任何中间 Factory 合约

#### Scenario: 部署前 L3 终检

- **WHEN** Step 5 启动
- **THEN** wizard SHALL 重读 Admin 的 ZDT 余额并重验 `balance >= declaredTotal`
- **AND** SHALL 重验 `draftVersion === snapshot.draftVersion`
- **AND** 任一校验失败时 SHALL 以明确错误信息中止

#### Scenario: finalize KMS callback 超时

- **WHEN** 子步骤 5.4 成功,但 active-pull 调用 KMS Gateway publicDecrypt 在重试上限内仍失败(Gateway 不可用)
- **THEN** wizard SHALL 显示超时错误
- **AND** 错误中显示的修复建议 SHALL 包含"使用 withdrawExcess 取回资金,然后重新部署"

### Requirement: 草稿自动保存与续行

wizard SHALL 在每次步骤切换后把草稿状态持久化到后端。草稿中的金额 SHALL 在客户端用 DEK+KEK 信封加密(详见 `draft-encryption` capability)后再传输。用户在同一台或不同设备上回到 dApp,SHALL 能从保存的步骤位置续行。

#### Scenario: 关浏览器后续行

- **WHEN** Admin 完成 Step 1-3,关闭浏览器
- **AND** 之后打开 dApp,签 SIWE,进入 `/wizard`
- **THEN** wizard SHALL 列出未完成草稿,并提供从保存步骤续行的入口
- **AND** 解密金额 SHALL 在使用同一钱包时成功

### Requirement: URL 接管支持跨设备访问

每个已部署 campaign SHALL 有形如 `/c/<address>?role=<admin|recipient|auditor>` 的可分享 URL。访问该 URL SHALL 把 campaign 地址写入本地已知列表,并路由到对应角色视图。URL 中的 role 提示 SHALL 仅作为 UI hint,实际渲染视图 SHALL 根据合约的 `admin()`、`auditor()` 与连接钱包的对比来决定。

#### Scenario: URL 提示与实际一致

- **WHEN** 真正的 admin 钱包打开 `/c/0xCAMP?role=admin`
- **THEN** AdminPage SHALL 渲染

#### Scenario: URL 提示与实际不符

- **WHEN** 匿名用户用非 admin 钱包打开 `/c/0xCAMP?role=admin`
- **THEN** dApp SHALL 显示 public 视图(或"你不是该 campaign 的 admin"提示)
- **AND** SHALL NOT 仅凭 URL 参数授予任何 admin 权限

### Requirement: 5 层校验 cascade 完整定义

wizard 与合约共同实现 5 层校验,层层兜底。每一层 SHALL 显式定义触发时机与责任:

- **L1(实时输入校验)**: Step 2 每次 keystroke 触发。校验地址合法、金额 strict uint64 解析、金额 > 0、列表内无重复
- **L2(列表级校验)**: Step 2 → 3 切换时触发。校验 list 非空、sum > 0、sum ≤ 当前钱包 ZDT 余额
- **L3(部署前最终校验)**: Step 5 启动前触发。重读 Admin 钱包余额、重解析 ENS、校验 `draft.version === snapshot.draftVersion`
- **L4(合约 setAllocation 内部校验)**: 链上每笔 setAllocation tx 触发。校验 onlyAdmin、`state == Setup`、append-only、累加 `allocationCount`
- **L5(合约 finalize FHE.eq + KMS 校验)**: finalize tx 触发。校验 `allocationCount == recipientCount`、`balanceOf >= declaredTotal`、密文域 sum check 通过、KMS 阈值签名校验

每一层 SHALL 是上一层的兜底,任何一层失败 SHALL 立即中止 wizard 并显示具体原因。

#### Scenario: L1 错误实时反馈

- **WHEN** Admin 在 Step 2 输入非法地址或非 uint64 金额
- **THEN** UI SHALL 实时高亮错误行
- **AND** Next 按钮 SHALL 处于 disabled 状态直到错误清除

#### Scenario: L2 错误阻断切步

- **WHEN** Step 2 列表为空、sum 为 0、sum 超过钱包余额或存在重复地址
- **AND** Admin 点击 Next
- **THEN** wizard SHALL 留在 Step 2 并显示对应错误信息

#### Scenario: L3 终检失败

- **WHEN** Step 5 启动前的重检发现余额变化、ENS 漂移或 `draft.version !== snapshot.draftVersion`
- **THEN** Step 5 SHALL 启动失败并显示具体原因(余额变化 / ENS 漂移 / draft 版本不一致)

#### Scenario: L4 setAllocation revert

- **WHEN** 链上某笔 setAllocation 因 onlyAdmin、`state != Setup` 或 append-only 检查失败而 revert
- **THEN** wizard SHALL 显示部分完成状态并标记草稿为 `failed_partial`

#### Scenario: L5 KMS sum check 失败

- **WHEN** finalize 的密文域 sum check 通过 KMS 阈值签名后返回 false
- **THEN** 合约 SHALL 进入 Failed 状态
- **AND** wizard SHALL 引导用户调用 `cancelCampaign()` 取回资金后重新部署

### Requirement: 部署中断续行(failed_partial)

如果 Step 5 某个子步骤(5.1 deploy / 5.2 fund / 5.3 setAllocation × N / 5.4 finalize)失败或被取消,wizard SHALL 把草稿 status 标记为 `failed_partial`,并持久化 `campaignAddress`(若 5.1 已完成)与已成功 setAllocation 的 recipient 列表(若 5.3 部分完成)。

用户重新进入 wizard 时,SHALL 提供"从断点续行"选项。续行时 wizard SHALL:
- 跳过已完成的子步骤(通过链上 `campaign.allocationSet(addr)` 验证)
- 不重复尝试已成功的 setAllocation
- 如果 5.4 已发起但 5.5 未回调,继续等待 KMS callback

#### Scenario: 5.3 中途失败

- **WHEN** 子步骤 5.3 第 30 笔 setAllocation 失败
- **THEN** 草稿状态 SHALL 变为 `failed_partial`
- **AND** wizard SHALL 持久化 `campaignAddress` 与前 29 个已成功 allocated 的 recipient 列表

#### Scenario: 从断点续行

- **WHEN** 用户重新进入 wizard 并选择"从断点续行"
- **THEN** wizard SHALL 通过链上 `campaign.allocationSet(addr)` 验证已完成的 recipient
- **AND** SHALL 跳过前 29 个,从第 30 个开始继续 setAllocation
- **AND** SHALL NOT 重复尝试任何已成功的 setAllocation

#### Scenario: 放弃续行并取回资金

- **WHEN** 用户对于一个 `failed_partial` 草稿选择放弃续行
- **THEN** wizard SHALL 提供"取消并取回"路径
- **AND** finalize 失败时 SHALL 通过 `cancelCampaign` 取回资金
- **AND** claiming 状态时 SHALL 通过 `withdrawExcess` 取回资金

### Requirement: 大列表 gas 警告

当 recipient 数量超过推荐阈值(MVP 设为 50),wizard SHALL 在 Step 4 Review 与 Step 5 启动前显示明显的 gas 警告,告知:
- 预估总 gas 成本(约 `0.05 + 0.005 + 0.004 × N + 0.03` ETH)
- 单 tx 模式无 batch,N 越大风险越高
- 建议拆分成多个 campaign 或等待 V8+ batch 支持

#### Scenario: N = 50 阈值内

- **WHEN** recipient 数量为 50
- **THEN** Step 4 SHALL 显示标准 gas 估算
- **AND** SHALL NOT 显示 gas 警告

#### Scenario: N = 100 橙色警告

- **WHEN** recipient 数量为 100
- **THEN** Step 4 与 Step 5 启动前 SHALL 显示橙色"高 gas 成本"警告
- **AND** wizard SHALL 仍允许用户继续

#### Scenario: N > 200 二次确认

- **WHEN** recipient 数量超过 200
- **THEN** Step 4 与 Step 5 启动前 SHALL 显示红色警告
- **AND** SHALL 要求用户进行二次确认才能继续

