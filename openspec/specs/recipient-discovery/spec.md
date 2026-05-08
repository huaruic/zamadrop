# recipient-discovery Specification

## Purpose
TBD - created by archiving change v7-dapp-wizard. Update Purpose after archive.
## Requirements
### Requirement: SIWE 鉴权 session

dApp SHALL 提供 Sign-In With Ethereum(SIWE,EIP-4361)登录流程。登录 SHALL 零 gas(只签名,不上链)。后端 SHALL 通过 ecrecover 验签,校验一次性 nonce,然后颁发绑定到所恢复地址的 session token(JWT)。

#### Scenario: 用户签 SIWE 消息获取 session

- **WHEN** 已连接钱包用户点击"Sign in",并在钱包中确认人类可读的 SIWE 消息
- **THEN** 后端 SHALL 校验签名通过
- **AND** SHALL 颁发包含 `address` claim(等于恢复出的地址)的 session token
- **AND** SHALL NOT 产生任何上链交易

#### Scenario: 拒绝过期或未知的 nonce

- **WHEN** 提交的 SIWE 消息所带 nonce 已被消费或已过期
- **THEN** 后端 SHALL 返回 `401 Unauthorized`
- **AND** SHALL NOT 颁发 session

#### Scenario: 拒绝错误签名

- **WHEN** `POST /api/auth/siwe` 收到的签名 ecrecover 后与所声明地址不符
- **THEN** 后端 SHALL 返回 `401 Unauthorized`

### Requirement: Recipient 自查 API

后端 SHALL 提供一个 SIWE 鉴权的 `POST /api/me/campaigns` 端点。处理函数 SHALL 从 session token 提取钱包地址,并返回该地址作为 recipient 出现的所有 campaign(在已索引的 `AllocationSet` 事件上 join)。

#### Scenario: Recipient 只看到自己的 campaign

- **WHEN** 钱包 `0xALICE` 完成 SIWE 登录
- **AND** 是 C1、C2 的 recipient(但不是 C3)
- **AND** 调用 `POST /api/me/campaigns`
- **THEN** 响应 SHALL 包含 C1 与 C2
- **AND** SHALL NOT 包含 C3

#### Scenario: 其他钱包查不到 Alice 的数据

- **WHEN** 钱包 `0xBOB` 已登录(或无 session)
- **AND** 查询 `/api/me/campaigns`
- **THEN** 响应 SHALL 只包含 Bob 自己的 campaign(无 session 时返回 401)
- **AND** SHALL NOT 包含 Alice 的 campaign

### Requirement: Recipient 领取流程

`/c/<address>` 的 Recipient 视图 SHALL 允许 recipient 查看自己 FHE 加密的 allocation(通过 Zama relayer SDK 在客户端解密),并调用 `claim()` 发起领取。

#### Scenario: Recipient 看到自己解密后的金额

- **WHEN** recipient 连接钱包并访问 campaign URL
- **AND** 合约已 finalize
- **THEN** dApp SHALL 调用 `requestMyAllocation()`,经 relayer SDK 在客户端解密,然后显示明文金额

#### Scenario: 非 recipient 不能解密

- **WHEN** 非 recipient 地址访问 campaign URL
- **AND** dApp 尝试 `requestMyAllocation()`
- **THEN** 调用 SHALL 以 `NoAllocation` 回滚
- **AND** dApp SHALL 显示"你不在该 campaign 的 recipient 列表中"

#### Scenario: claim 按钮仅在 finalize 后且未领取时可见

- **WHEN** campaign 状态是 `Claiming`(finalized=true)且用户尚未 claim
- **THEN** 一个"Claim"按钮 SHALL 可见

- **WHEN** 用户已 claim(`claimed[user] = true`)
- **THEN** 按钮 SHALL 显示领取后状态(如"Transfer pending..."或"Transferred X ZDT")

### Requirement: SIWE 范围的诚实表述

dApp UI 与 `docs/SECURITY.md` SHALL 显式声明 SIWE 的定位是"防滥用 + UX,不是隐私层"。任何"通过本 API 提供成员隐私"的暗示性宣称 SHALL 在文档中明确被标记为不成立。

#### Scenario: 文档反映诚实表述

- **WHEN** 读者打开 `docs/SECURITY.md`
- **THEN** 隐私边界章节 SHALL 包含原话:"SIWE 保护的是我们便利 API 的访问,而不是底层的链上数据"
- **AND** SHALL 注明任何人可以通过直接索引链上事件复现等价查询

### Requirement: 重复 claim 防御

合约 SHALL 在 `claim()` 中检查 `claimed[msg.sender]` 标志。该标志在第一次 claim 成功后被置为 `true`(在任何状态修改之前,防双花)。第二次调用 `claim()` 同一地址 SHALL 以 `AlreadyClaimed()` revert。

backend indexer 处理 `Claimed(recipient)` 事件 SHALL 幂等:重复观察同一 (campaign, recipient) 的 Claimed 事件 SHALL 不会插入重复 row,通过 PRIMARY KEY 或 ON CONFLICT 子句保证。

`TokenTransferred` 事件同样 SHALL 通过 (campaign, recipient) 唯一约束阻止重复处理,即使 chain reorg 导致同事件被 indexer 重新看见。

#### Scenario: 同地址第二次 claim revert

- **WHEN** recipient `0xALICE` 已成功调用 `claim()`,且 `claimed[0xALICE] = true`
- **AND** `0xALICE` 第二次调用 `claim()`
- **THEN** 调用 SHALL 以 `AlreadyClaimed()` revert
- **AND** 不产生新的 `Claimed` 或 `ClaimRequested` 事件
- **AND** `claimed[0xALICE]` 维持 `true`

#### Scenario: indexer 重复观察 Claimed 事件幂等

- **WHEN** indexer 因 chain reorg 或 worker 重启,第二次扫到同一 `Claimed(0xALICE)` 事件
- **THEN** `claims` 表的 (campaign_address, user_address) 行 SHALL NOT 重复插入
- **AND** 已有 row 的字段 SHALL NOT 被错误覆盖(只在 `transferred_at_block` 仍为 NULL 且新事件提供 transferred_at_block 时更新)

#### Scenario: TokenTransferred 重复观察幂等

- **WHEN** indexer 重复观察同一 `TokenTransferred(0xALICE, 5000)` 事件
- **THEN** `claims` 行的 `amount` SHALL 维持 `5000`(不累加)
- **AND** `claimedTotalPlaintext` 在合约层不会受 indexer 影响(它由链上 executeTransfer 累加,只发生一次)

