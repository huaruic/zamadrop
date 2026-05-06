## ADDED Requirements

### Requirement: 构造器接受显式 admin 参数

合约 SHALL 通过构造器的显式参数接收 admin 地址,而不再从 `msg.sender` 推导。这使 Safe / EIP-4337 / ERC-2771 等钱包可以在部署时指定真实的控制方 EOA,而不要求部署者本身就是 admin。

#### Scenario: 部署者与 admin 不同

- **WHEN** 由 `deployer_addr` 部署合约,同时传入 `admin_ = different_addr`
- **THEN** `campaign.admin()` SHALL 返回 `different_addr`
- **AND** `campaign.admin()` SHALL NOT 等于 `deployer_addr`

#### Scenario: admin 部署后不可变

- **WHEN** 在部署后的任何时刻读取 `campaign.admin()`
- **THEN** 返回值 SHALL 等于构造器传入的值
- **AND** SHALL NOT 存在任何可以修改 `admin` 的函数

### Requirement: 构造器校验 recipient 列表 hash

构造器 SHALL 接受 `recipients` 数组和 `listHash` 参数,并 SHALL 计算 `keccak256(abi.encode(recipients))`,若不等于 `listHash` 则 SHALL 以 `HashMismatch()` 回滚。`listHash` SHALL 作为 `recipientListHash` immutable 储存。

#### Scenario: hash 与 recipients 一致

- **WHEN** 构造器接收 `recipients = [A, B, C]` 和 `listHash = keccak256(abi.encode([A, B, C]))`
- **THEN** 合约 SHALL 部署成功
- **AND** `campaign.recipientListHash()` SHALL 等于 `listHash`

#### Scenario: hash 不一致

- **WHEN** 构造器接收 `recipients = [A, B]` 但 `listHash = keccak256("wrong")`
- **THEN** 部署 SHALL 以 `HashMismatch()` 回滚

#### Scenario: recipients 数组不上链

- **WHEN** 合约部署完成
- **THEN** `recipients` 数组 SHALL NOT 持久化到合约 storage(只存 hash)
- **AND** `recipientCount` SHALL 等于 `recipients.length`

### Requirement: allocationCount 跟踪 setAllocation 调用次数

合约 SHALL 维护一个公开的 `uint64 allocationCount`,每次 `setAllocation` 成功调用后 SHALL 递增 1。`finalize()` SHALL 在 `allocationCount != recipientCount` 时以 `CountMismatch()` 回滚。

#### Scenario: 初始为 0

- **WHEN** 合约刚部署
- **THEN** `campaign.allocationCount()` SHALL 等于 `0`

#### Scenario: 每次 setAllocation 后递增

- **WHEN** Admin 依次为 `N` 个不同 recipient 调用 `setAllocation`
- **THEN** 最后一次调用结束后 `campaign.allocationCount()` SHALL 等于 `N`

#### Scenario: 数量不匹配时 finalize 阻断

- **WHEN** `recipientCount = 3`,但 Admin 只调用了两次 `setAllocation`
- **AND** Admin 调用 `finalize()`
- **THEN** 调用 SHALL 以 `CountMismatch()` 回滚

### Requirement: finalize 必须 escrow 充足

`finalize()` SHALL 在 `token.balanceOf(address(this)) < declaredTotal` 时以 `NotFunded()` 回滚。这避免"Admin 忘了打钱、recipient claim 时 transfer 失败"的隐性故障。

#### Scenario: 合约未注资

- **WHEN** Admin 完成所有 recipient 的 setAllocation,但没有把 ZDT 打到合约
- **AND** Admin 调用 `finalize()`
- **THEN** 调用 SHALL 以 `NotFunded()` 回滚

#### Scenario: 合约恰好注资

- **WHEN** 合约持有恰好 `declaredTotal` 数量的 ZDT
- **AND** Admin 在 `allocationCount == recipientCount` 时调用 `finalize()`
- **THEN** 调用 SHALL 进入 FHE.eq 总和校验阶段

#### Scenario: 合约超额注资

- **WHEN** 合约持有超过 `declaredTotal` 的 ZDT
- **AND** Admin 调用 `finalize()`
- **THEN** NotFunded 检查 SHALL 通过(超额可接受,多余部分通过 `withdrawExcess` 取回)

### Requirement: executeTransfer 使用 SafeERC20

`executeTransfer` SHALL 使用 `SafeERC20.safeTransfer(user, amount)`,而不是 `require(token.transfer(...))`。这为非标准 ERC20(不返回 bool 等)提供前向兼容。

#### Scenario: 标准 ERC20 转账

- **WHEN** 以合法 KMS proof 调用 `executeTransfer(user, amount, proof)`
- **AND** token 是标准 ERC20(如 ZDT)
- **THEN** `safeTransfer` SHALL 把 `amount` 转给 `user`
- **AND** `transferred[user]` SHALL 被置为 `true`

### Requirement: claimedTotalPlaintext 累加器

合约 SHALL 维护一个公开的 `uint64 claimedTotalPlaintext`,在每次 `executeTransfer` 成功时 SHALL 累加 `amount`。这支持公开偿付不变式 `balance >= declaredTotal - claimedTotalPlaintext`。

#### Scenario: 初始为 0

- **WHEN** 合约刚部署
- **THEN** `campaign.claimedTotalPlaintext()` SHALL 等于 `0`

#### Scenario: 每次 executeTransfer 后累加

- **WHEN** `executeTransfer` 先以 amount=600 给 user A 成功,再以 amount=400 给 user B 成功
- **THEN** `campaign.claimedTotalPlaintext()` SHALL 等于 `1000`

#### Scenario: 仅 claim 不影响计数器

- **WHEN** 用户调用 `claim()`(只 emit ClaimRequested),但 executor 还没调用 `executeTransfer`
- **THEN** `claimedTotalPlaintext` SHALL NOT 变化

### Requirement: withdrawExcess(Option C)

合约 SHALL 提供 `withdrawExcess(uint256 amount)`,只有 `admin` 可调用。函数 SHALL 计算 `stillOwed = declaredTotal - claimedTotalPlaintext` 与 `maxWithdraw = balance - stillOwed`;若 `balance <= stillOwed` SHALL 以 `NoExcess()` 回滚;若 `amount > maxWithdraw` SHALL 以 `ExceedsExcess()` 回滚;否则 SHALL 通过 `safeTransfer` 把 `amount` 转给 admin,并 emit `ExcessWithdrawn(amount, balance - amount)`。

`withdrawExcess` SHALL 仅在 `state == Claiming` 状态下可用。在 `Setup` / `Finalizing` / `Failed` 状态下调用 SHALL revert。`Failed` 状态下的资金救援 SHALL 通过 `cancelCampaign()` 完成,而不是 `withdrawExcess`。

#### Scenario: 非 admin 被拒

- **WHEN** 非 admin 地址调用 `withdrawExcess(1)`
- **THEN** 调用 SHALL 以 `NotAdmin()` 回滚

#### Scenario: 没有可取余额

- **WHEN** `balance == declaredTotal - claimedTotalPlaintext`(余额刚好覆盖未领部分)
- **AND** Admin 调用 `withdrawExcess(1)`
- **THEN** 调用 SHALL 以 `NoExcess()` 回滚

#### Scenario: 在可取范围内

- **WHEN** `balance = 1500`,`declaredTotal = 1000`,`claimedTotalPlaintext = 0`(此时 stillOwed = 1000,maxWithdraw = 500)
- **AND** Admin 调用 `withdrawExcess(500)`
- **THEN** Admin 余额 SHALL 增加 500
- **AND** 合约余额 SHALL 等于 1000

#### Scenario: 超出 maxWithdraw

- **WHEN** `maxWithdraw = 500` 时 Admin 调用 `withdrawExcess(501)`
- **THEN** 调用 SHALL 以 `ExceedsExcess()` 回滚

#### Scenario: 取款后 recipient 仍偿付

- **WHEN** 任何成功的 `withdrawExcess(amount)` 完成后
- **THEN** 调用后不变式 SHALL 成立:`balance >= declaredTotal - claimedTotalPlaintext`

#### Scenario: withdrawExcess 在非 Claiming 状态拒绝

- **WHEN** state 是 `Setup` 或 `Finalizing` 或 `Failed`
- **AND** Admin 调用 `withdrawExcess(any amount)`
- **THEN** 调用 SHALL 以适当错误(如 `NotClaiming()`)revert

### Requirement: 偿付不变式

部署后任意时刻,在 `finalize()` 已成功的前提下,合约 SHALL 维持不变式 `token.balanceOf(address(this)) >= declaredTotal - claimedTotalPlaintext`。这一不变式 SHALL 可被任何观察者独立验证。

#### Scenario: Auditor 独立验证

- **WHEN** Auditor 在 finalize 后任意时刻读取 `balanceOf`、`declaredTotal`、`claimedTotalPlaintext`
- **THEN** `balance >= declaredTotal - claimedTotalPlaintext` SHALL 成立
- **OR** 合约已在协议层被攻陷

### Requirement: 显式状态机

合约 SHALL 暴露一个公开的 `enum State` 字段(或等价的复合状态访问器),取值为 `Setup` / `Finalizing` / `Claiming` / `Failed`。状态转换 SHALL 严格遵守:`Setup → Finalizing`(由 `finalize()` 触发)→ `Claiming`(由 `callbackFinalize(true)` 触发)或 `Finalizing → Failed`(由 `callbackFinalize(false)` 触发)。`Failed` SHALL 是终态,不可回到 `Setup`。

#### Scenario: 初始状态

- **WHEN** 合约刚部署
- **THEN** `campaign.state()` SHALL 等于 `Setup`

#### Scenario: finalize 成功后进入 Finalizing

- **WHEN** Admin 在 `state == Setup` 下成功调用 `finalize()`
- **THEN** `campaign.state()` SHALL 变为 `Finalizing`

#### Scenario: callbackFinalize(true) 后进入 Claiming

- **WHEN** KMS 以合法签名调用 `callbackFinalize(true, ...)`,且当前 `state == Finalizing`
- **THEN** `campaign.state()` SHALL 变为 `Claiming`

#### Scenario: callbackFinalize(false) 后进入 Failed

- **WHEN** KMS 以合法签名调用 `callbackFinalize(false, ...)`,且当前 `state == Finalizing`
- **THEN** `campaign.state()` SHALL 变为 `Failed`

#### Scenario: Failed 是终态

- **WHEN** `state == Failed`
- **AND** 任何 caller 调用 `setAllocation` / `finalize` / `callbackFinalize` / `claim` 中的任一函数
- **THEN** 调用 SHALL revert
- **AND** state SHALL NOT 回到 `Setup` 或任何其他状态

### Requirement: setAllocation 重复防御

`setAllocation` 对同一 `recipient` 调用第二次 SHALL 以 `AllocationAlreadySet()` revert。`allocationCount` SHALL NOT 增加。原 ciphertext SHALL NOT 被覆盖。

#### Scenario: 同一 recipient 第二次 setAllocation revert

- **WHEN** Admin 已为 `recipient_A` 成功调用过一次 `setAllocation`
- **AND** Admin 再次为 `recipient_A` 调用 `setAllocation`
- **THEN** 调用 SHALL 以 `AllocationAlreadySet()` revert

#### Scenario: revert 后 allocationCount 不变

- **WHEN** 上述第二次 `setAllocation` revert
- **THEN** `campaign.allocationCount()` SHALL 维持原值(只算第一次成功的那次)

#### Scenario: revert 后 ciphertext 保持原值

- **WHEN** 上述第二次 `setAllocation` revert
- **AND** `recipient_A` 调用 `requestMyAllocation`
- **THEN** 返回的 ciphertext handle SHALL 等于第一次 `setAllocation` 写入的原始 handle

### Requirement: finalize 在非 Setup 状态拒绝

`finalize()` SHALL 仅在 `state == Setup` 时可调用。在 `Finalizing` / `Claiming` / `Failed` 任何状态下调用 SHALL revert。

#### Scenario: finalize 二次调用 revert

- **WHEN** Admin 已成功调用 `finalize()` 一次(此时 `state == Finalizing`)
- **AND** Admin 再次调用 `finalize()`
- **THEN** 调用 SHALL revert

#### Scenario: Claiming 状态下 finalize revert

- **WHEN** `state == Claiming`
- **AND** Admin 调用 `finalize()`
- **THEN** 调用 SHALL revert

#### Scenario: Failed 状态下 finalize revert

- **WHEN** `state == Failed`
- **AND** Admin 调用 `finalize()`
- **THEN** 调用 SHALL revert

### Requirement: callbackFinalize 重放防御

`callbackFinalize` SHALL 仅在 `state == Finalizing` 时接受。重复或在其他状态下调用 SHALL revert。

#### Scenario: 重复 callback revert

- **WHEN** KMS 已经成功调用过一次 `callbackFinalize`(无论结果是 true 还是 false)
- **AND** KMS 再次以合法签名调用 `callbackFinalize`
- **THEN** 第二次调用 SHALL revert

#### Scenario: Setup 状态下 callbackFinalize revert

- **WHEN** `state == Setup`(`finalize()` 还没被调用过)
- **AND** 任何人(即便携带合法签名)调用 `callbackFinalize`
- **THEN** 调用 SHALL revert

### Requirement: claim 在非 Claiming 状态拒绝

`claim()` SHALL 仅在 `state == Claiming` 时可调用。`Setup` / `Finalizing` / `Failed` 任何状态下 SHALL revert。

#### Scenario: Finalizing 等待 KMS callback 期间 claim revert

- **WHEN** `state == Finalizing`(已 `finalize()` 但 KMS callback 还没到)
- **AND** recipient 调用 `claim()`
- **THEN** 调用 SHALL revert

#### Scenario: Failed 状态下 claim revert

- **WHEN** `state == Failed`
- **AND** recipient 调用 `claim()`
- **THEN** 调用 SHALL revert

### Requirement: cancelCampaign 失败救援

合约 SHALL 提供 `cancelCampaign()` 函数,只有 `admin` 可调,SHALL 仅在 `state == Failed` 时可用。该函数 SHALL 把合约持有的全部 token 余额转给 `admin`,并 emit `CampaignCancelled(uint256 returnedAmount)` 事件。SHALL NOT 改变状态(`Failed` 是终态)。

#### Scenario: 非 admin 调用 revert

- **WHEN** 非 admin 地址在 `state == Failed` 下调用 `cancelCampaign()`
- **THEN** 调用 SHALL 以 `NotAdmin()` revert

#### Scenario: 非 Failed 状态调用 revert

- **WHEN** state 是 `Setup` 或 `Finalizing` 或 `Claiming`
- **AND** Admin 调用 `cancelCampaign()`
- **THEN** 调用 SHALL 以 `NotFailed()` revert

#### Scenario: Failed 状态下 admin 调用成功

- **WHEN** `state == Failed`
- **AND** 合约持有 `B` 数量的 token
- **AND** Admin 调用 `cancelCampaign()`
- **THEN** `B` 数量的 token SHALL 通过 `safeTransfer` 转给 `admin`
- **AND** SHALL emit `CampaignCancelled(B)`

#### Scenario: 全额可取(claimedTotalPlaintext == 0)

- **WHEN** `state == Failed`(意味着 `callbackFinalize(true)` 从未发生,因此没人 claim 过)
- **THEN** `claimedTotalPlaintext` SHALL 等于 `0`
- **AND** Admin 调用 `cancelCampaign()` SHALL 取走合约全部余额

#### Scenario: 重复调用第二次自然失败

- **WHEN** Admin 已成功调用过一次 `cancelCampaign()`(合约 balance 现在为 0)
- **AND** Admin 再次调用 `cancelCampaign()`
- **THEN** 调用 SHALL revert(因为 `safeTransfer(0)` 失败或显式以 `NoBalance()` revert)
