# auditor-verification Specification

## Purpose
TBD - created by archiving change v7-dapp-wizard. Update Purpose after archive.
## Requirements
### Requirement: Auditor 视图完全只读

`/c/<address>?role=auditor` 的 Auditor 视图 SHALL 完全只读。Auditor SHALL NOT 在 UI 上拥有任何**修改链上状态**的输入或按钮。允许存在的只读交互控件包括:校验 recipient 列表 hash(本地计算,无网络调用)、校验单笔 KMS 签名(本地验证)、以及请求解密 `_claimedTotal`(通过 Zama Gateway,链下,无链上 tx)。所有这些交互 SHALL NOT 产生任何修改 campaign 状态的 transaction。

#### Scenario: 没有任何修改类 UI

- **WHEN** auditor 钱包查看 auditor 页面
- **THEN** 页面 SHALL NOT 包含任何提交修改 campaign 状态交易的按钮或表单
- **AND** 任何允许的交互控件 SHALL 限定在:本地校验类(hash 重算 / KMS 签名校验)和链下解密请求(Gateway)。所有交互 SHALL NOT 产生任何 transaction

### Requirement: 结算完整性校验

Auditor 视图 SHALL 显示来自 `callbackFinalize` 的总和校验状态。dApp SHALL 拉取原始 `callbackFinalize` 交易的 `decryptionProof`(KMS 签名),并在客户端通过 FHE relayer SDK 校验。

#### Scenario: 总和校验通过

- **WHEN** 拉取已 finalize 的 campaign 的 `callbackFinalize` 交易
- **AND** 客户端通过 `FHE.checkSignatures` 等价语义校验通过
- **THEN** Auditor 视图 SHALL 显示"Sum check: ✅ KMS-signed at block <N>"

#### Scenario: 单笔 KMS 签名校验

- **WHEN** Auditor 查看每笔 claim 的审计轨迹
- **THEN** 对每个 `executeTransfer` 事件,dApp SHALL 拉取该交易的 `decryptionProof` 并校验它代表对 `(handle, amount)` 对的合法 KMS 签名
- **AND** 每笔 SHALL 显示 ✅ 或 ❌

### Requirement: 偿付不变式检查

Auditor 视图 SHALL 计算并显示偿付不变式 `balance >= declaredTotal - claimedTotalPlaintext`,所用值直接从链上读取。如果不变式不成立,视图 SHALL 显示明显的告警。

#### Scenario: 不变式成立

- **WHEN** `balanceOf(campaign) = 1500`,`declaredTotal = 1000`,`claimedTotalPlaintext = 600`
- **THEN** stillOwed = 400,balance >= stillOwed → 不变式成立
- **AND** 视图 SHALL 显示"✅ Solvent: 余额覆盖所有未领分配"

#### Scenario: 不变式破裂

- **WHEN** 假设状态导致 `balance < stillOwed`
- **THEN** 视图 SHALL 显示"⚠️ INSOLVENT" 并标出差额

### Requirement: Recipient 列表 hash 校验

Auditor 视图 SHALL 提供"校验 recipient 列表"功能。dApp SHALL 拉取该 campaign 的所有 `AllocationSet` 事件,重建地址列表,计算 `keccak256(abi.encode(addresses))`,与 `campaign.recipientListHash()` 对比,并明确显示 ✅ 或 ❌。

#### Scenario: hash 与事件一致

- **WHEN** Auditor 点击"校验列表 hash"
- **AND** 从链上重建的事件列表 hash 等于 `recipientListHash`
- **THEN** 视图 SHALL 显示"✅ Recipient list verified: <N> 个事件与部署时 hash 一致"

#### Scenario: hash 不一致

- **WHEN** 重建 hash 与不可变 hash 不同
- **THEN** 视图 SHALL 显示"❌ MISMATCH"(实际只可能在协议层被篡改时发生)

#### Scenario: hash 算法精确定义(可测试)

Auditor 视图计算列表 hash 时 SHALL 遵守:

1. 从链上拉取该 campaign 合约的所有 `AllocationSet(address indexed recipient)` 事件
2. 按 `(blockNumber, transactionIndex, logIndex)` 升序排序
3. 提取每条事件的 `recipient` topic(已是 EIP-55 checksum 后的 20 字节地址,以小写形式比较)
4. 用 Solidity ABI 编码:`abi.encode(address[])`,等价于 viem 的 `encodeAbiParameters([{type:'address[]'}], [addresses])`
5. 对编码结果取 `keccak256` 作为最终 hash

- **WHEN** 完成上述 5 步,得到 32 字节 hash
- **THEN** SHALL 等于链上 `campaign.recipientListHash()` 不可变值
- **OR** 视图 SHALL 显示 ❌ MISMATCH

任何排序变化、地址大小写差异、或编码方式偏离 SHALL 导致 hash 不一致 — 这是可测试的,实现 SHALL 包含至少一个单元测试断言以上 5 步算法的输出与合约 immutable hash 完全一致。

### Requirement: 已领总额聚合解密

Auditor(且仅 Auditor)SHALL 能够通过 Zama relayer SDK 请求 `_claimedTotal`(FHE 加密)的解密。该权限由合约在构造与每次 claim 后调用的 `FHE.allow(_claimedTotal, auditor)` 授予。解密结果 SHALL 等于 `claimedTotalPlaintext`(公开累加器)。

#### Scenario: Auditor 解密

- **WHEN** 当前连接钱包等于 campaign 的 `auditor`
- **AND** 用户点击"解密已领总额"
- **THEN** relayer SDK SHALL 成功返回明文总额
- **AND** 该值 SHALL 等于 `claimedTotalPlaintext`

#### Scenario: 非 Auditor 无法解密

- **WHEN** 非 auditor 钱包尝试相同解密
- **THEN** relayer SDK SHALL 拒绝该请求(FHE.allow 未授权该地址)

### Requirement: Auditor 列表查询公开

后端 `/api/auditor/<address>/campaigns` 端点 SHALL 公开(不需要 SIWE)。Auditor 关系本身在设计上就是公开的——给该端点加鉴权不会带来任何隐私收益,反而会错误地暗示"auditor 关系是机密的"。

#### Scenario: 任何人可列出 Alice 担任审计的 campaign

- **WHEN** 请求 `/api/auditor/0xALICE/campaigns`
- **THEN** 响应 SHALL 列出所有 Alice 是指定 auditor 的 campaign
- **AND** SHALL NOT 要求任何鉴权

