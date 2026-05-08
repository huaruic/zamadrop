# privacy-boundary Specification

## Purpose
TBD - created by archiving change v7-dapp-wizard. Update Purpose after archive.
## Requirements
### Requirement: 用户可见文案诚实地表述隐私

dApp 首页与 `docs/SECURITY.md` SHALL 显式说明 ZamaDrop 实际具备的隐私属性。SHALL NOT 使用"机密空投"或任何暗示全生命周期隐私的措辞。最低要求的表述 SHALL 是：

> ZamaDrop 在 claim 之前对每个分配金额加密，在 claim 或授权解密之时方才公开；但接收者的资格信息是链上公开的——任何人通过索引合约事件都能枚举所有 recipient 钱包。

#### Scenario: 首页带这句诚实说明

- **WHEN** 首次访客打开 dApp 首页
- **THEN** 可见的 hero / header 文案 SHALL 包含上述声明（中英文均可）
- **AND** SHALL 链接到 `docs/SECURITY.md` 查看完整隐私边界

### Requirement: SECURITY.md 隐私边界章节

`docs/SECURITY.md` SHALL 包含一段显式列出的隐私边界，涵盖：(1) 受保护的部分、(2) 不受保护的部分、(3) 信任模型、(4) V8+ 关于成员隐私的路线图。

#### Scenario: 受保护清单

- **WHEN** 读者查找"What's Protected"段
- **THEN** 列表 SHALL 包含：
  - 分配金额在 at-rest 阶段的隐私（链上 FHE euint64 密文）
  - 结算完整性（FHE.checkSignatures 防止任何 caller 伪造 amount/bool）
  - 聚合隐私原语（Auditor 仅解密 `_claimedTotal`）
  - 偿付不变式（可被任何人独立验证）

#### Scenario: 不受保护清单

- **WHEN** 读者查找"What's NOT Protected"段
- **THEN** 列表 SHALL 包含：
  - 接收者成员身份（`AllocationSet` 事件公开地址）
  - claim 时金额（`TokenTransferred` 事件以明文广播金额）
  - SIWE 仅做 API 防滥用（链上数据仍公开，SIWE 不是隐私层）

### Requirement: 信任模型表述为协议层假设

SECURITY.md SHALL 说明 Zama KMS 当前由许可制运营方组合维护，这是协议级信任假设，不是 ZamaDrop 设计选择。文档 SHALL 避免使用 "validators"（暗示别的共识角色），改用 "KMS parties / nodes / operators" 或 "threshold MPC parties"。

#### Scenario: 术语精确

- **WHEN** 读者扫读 SECURITY.md 中与 KMS 相关的术语
- **THEN** 文档 SHALL 使用 "threshold MPC" 而非 "M-of-N consensus"
- **AND** SHALL NOT 写出特定阈值比例（因为线上配置可能调整）

### Requirement: V8+ 路线图明示

SECURITY.md SHALL 列出 V7 不提供、计划在 V8+ 提供的保护项，至少包括：基于 commitments / nullifiers / Merkle / stealth address 的成员隐私、真正的 confidential token（ERC-7984）、pause / cancel / time-lock 控制。

#### Scenario: 读者可据此规划是否使用

- **WHEN** 潜在用户阅读 SECURITY.md 评估是否适用
- **THEN** 他们 SHALL 能判断 ZamaDrop V7 是否适合自己的场景（如成员身份不敏感的内部薪酬），还是应该等 V8+（如对抗性场景下的 KOL 分配）

### Requirement: role-page-protocol.md 标记被取代

`docs/role-page-protocol.md`（V6 的 4-tab 模型）SHALL 在文件顶部加一条 banner，标记其已被 V7 设计取代，并指向 V7 权威来源。该文件 SHALL 保留在仓库中作为历史参考，但 SHALL 不再被视作权威。

#### Scenario: banner 存在

- **WHEN** 读者打开 `docs/role-page-protocol.md`
- **THEN** 第一个内容块 SHALL 是"Superseded by V7" banner，带有指向 V7 真理来源（本 change 的 specs）的链接

### Requirement: README 表述与现实一致

仓库 `README.md` SHALL 不宣称超过 V7 实际能力的隐私属性。任何"私有分配"标语 SHALL 配以一行关于"成员身份公开"的说明，或链接到 SECURITY.md。

#### Scenario: README 准确

- **WHEN** 潜在贡献者或用户阅读 `README.md`
- **THEN** 他们 SHALL 找不到"完全私有"/"匿名"/"机密接收者"等误导性宣称
- **AND** README 中关于隐私的表述 SHALL 与 SECURITY.md 保持一致

