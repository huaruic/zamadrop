## ADDED Requirements

### Requirement: 草稿金额用 DEK+KEK 信封加密

dApp SHALL 在把草稿 `amounts` 字段发往后端之前,使用 DEK+KEK 信封方案在客户端加密。每个草稿的 DEK SHALL 是新生成的 256-bit 随机密钥。DEK SHALL 通过 AES-GCM(每次保存使用新生成的 96-bit IV)加密 amounts。KEK SHALL 来自钱包对带 scope 信息的消息的签名;KEK SHALL 通过 AES-GCM(单独的新 IV)包装 DEK。

#### Scenario: 服务端拿不到明文金额

- **WHEN** 一份金额为 `[5000, 3000, 8000]` 的草稿被保存
- **AND** 请求到达后端
- **THEN** 后端 SHALL 只收到 `amountsCiphertext`、`amountsIv`、`wrappedDek`、`wrappedDekIv`、`scopeJson`
- **AND** SHALL NOT 在任何环节收到金额明文

#### Scenario: 加解密往返保留 amounts

- **WHEN** 先 Encrypt(amounts, signer, scope) 得到 ciphertext,再 Decrypt(ciphertext, signer, scope)
- **THEN** 解密结果 SHALL 等于原始 amounts

### Requirement: 带 scope 的 KEK 派生防 replay

KEK 派生消息 SHALL 包含一个 JSON 序列化的 scope 对象,至少含:`chainId`、`origin`、`admin`、`draftId`、`createdAt`、`purpose: "wrap-draft-dek-v1"`。一次 scope 下获取的签名 SHALL NOT 能解密其他 scope 下加密的草稿。

#### Scenario: 钓鱼网站 origin 不同时签名失效

- **WHEN** 攻击者诱导用户在 `origin: "https://zamadr0p.app"` 下签名
- **AND** 试图用该签名解密 `origin: "https://zamadrop.app"` 下加密的真草稿
- **THEN** 派生出的 KEK SHALL 无法解开真正的 `wrappedDek`

#### Scenario: 跨草稿 replay 失败

- **WHEN** 在 draft `draft_A` 下获得签名
- **AND** 用它尝试解密 `draft_B`
- **THEN** scope 中 `draftId` 不同导致 KEK 不匹配,解密 SHALL 失败

### Requirement: 每次保存都用新 IV

每次调用 `encryptDraftAmounts` SHALL 为两次 AES-GCM 操作(amounts 加密与 DEK 包装)生成新的随机 IV。在相同密钥下重用 IV 会让 AES-GCM 灾难性失效。

#### Scenario: 两次加密同一数据结果不同

- **WHEN** 用相同输入连续调用两次 `encryptDraftAmounts(amounts, signer, scope)`
- **THEN** `amountsIv` SHALL 两次不同
- **AND** `wrappedDekIv` SHALL 两次不同
- **AND** `amountsCiphertext` SHALL 两次不同
- **AND** SHALL 存在断言以上属性的单元测试

### Requirement: 钱包轮换通过重新包装支持

dApp SHALL 支持给已有草稿添加新钱包的访问权限:在旧钱包仍可用时,用户 SHALL 能够派生旧 KEK,解开已存的 DEK,用新钱包派生新 KEK,然后重新包装 DEK。`amountsCiphertext` SHALL NOT 需要重新加密。

#### Scenario: 旧钱包解、新钱包重新包装

- **WHEN** 旧钱包从 scope 派生 KEK_old,从 `wrappedDek_old` 解出 DEK
- **AND** 新钱包从相似 scope(同 draftId,但 admin 已改为新钱包)派生 KEK_new
- **AND** 用 KEK_new 把 DEK 重新包装产出 `wrappedDek_new`
- **THEN** 草稿记录中存的 `wrappedDek_new` SHALL 允许新钱包结合原始 `amountsCiphertext` 解密 amounts

### Requirement: recipient 地址与元数据明文存储

除 amounts 之外的草稿字段(recipient 地址列表、campaign 名称、描述、auditor 地址、当前步骤、draft id)SHALL 在数据库中明文存储。给这些字段加密不会带来隐私收益——recipient 列表本就将通过 `AllocationSet` 事件公开上链,元数据本身不敏感。

#### Scenario: recipient 地址可查询

- **WHEN** 草稿包含 `recipient_addrs = ["0xALICE", "0xBOB"]`
- **THEN** 这些值 SHALL 以明文 JSON 存于 `recipient_addrs` 列
- **AND** SHALL NOT 进入信封加密

### Requirement: 草稿访问按所有者隔离

草稿 SHALL 只能由原始创建者钱包(从 SIWE session 提取)读、写、删。其他地址 SHALL 收到 404(不是 403,以避免泄漏草稿是否存在)。

此外,跨设备或跨 tab 编辑场景下,草稿冲突保护由 `indexer-service` capability 的 `expectedDraftVersion` 乐观锁机制提供;`draft-encryption` 仅负责字段级密文,不涉及版本协调。

#### Scenario: 其他地址收到 404

- **WHEN** Bob 的 session 尝试 GET / PUT / DELETE 一个 Alice 拥有的草稿
- **THEN** 响应 SHALL 是 `404 Not Found`
- **AND** SHALL NOT 是 `403 Forbidden`(后者会确认草稿存在)
