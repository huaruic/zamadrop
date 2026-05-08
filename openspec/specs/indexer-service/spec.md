# indexer-service Specification

## Purpose
TBD - created by archiving change v7-dapp-wizard. Update Purpose after archive.
## Requirements
### Requirement: 后端服务技术栈

后端 SHALL 以 TypeScript Node.js 服务实现,运行 Express,连接 Postgres,使用 `viem` 做链上读取与事件订阅。SIWE 鉴权 SHALL 使用 `siwe` 包;session SHALL 基于 JWT。

#### Scenario: 服务启动并响应健康检查

- **WHEN** 后端在合法环境变量下启动
- **THEN** `GET /api/health` SHALL 返回 `200`,响应体 `{ "ok": true }`

### Requirement: 数据库 schema

Postgres schema SHALL 至少包含以下表:`campaigns`、`allocations`、`claims`、`campaign_drafts`、`siwe_nonces`、`kv_state`。表 SHALL 通过 SQL 迁移脚本(`backend/src/db/schema.sql`)创建,且在 `CREATE TABLE IF NOT EXISTS` 语义下幂等。

#### Scenario: 迁移可重复执行

- **WHEN** 迁移脚本被执行两次
- **THEN** 第二次执行 SHALL 不产生错误
- **AND** SHALL NOT 重复或修改已有行

### Requirement: 注册 campaign 时链上验真

后端 SHALL 暴露 `POST /api/register-campaign`,wizard 在部署成功后调用。处理函数 SHALL 通过 viem 直接从链上读取 `admin()` / `auditor()` / `recipientListHash()` / `declaredTotal()` / `recipientCount()`。如果请求体声明的 `admin` 与链上值(忽略大小写)不一致,SHALL 拒绝并返回 `400`。否则 SHALL 用链上验真后的值(而非请求体中的值)写入 `campaigns` 表。

#### Scenario: 合法注册

- **WHEN** wizard POST `{address: 0xCAMP, admin: 0xERNEST, ...}`,链上 `admin()` 返回 `0xERNEST`
- **THEN** campaign SHALL 被插入 `campaigns` 表
- **AND** 响应 SHALL 是 `200` `{ ok: true }`

#### Scenario: 伪造 admin 被拒

- **WHEN** 请求声明 `admin: 0xATTACKER`,但链上 `admin()` 返回 `0xERNEST`
- **THEN** 响应 SHALL 是 `400`,错误信息 "admin mismatch on-chain"
- **AND** 没有任何行 SHALL 被插入

### Requirement: Indexer worker 订阅事件

后台 worker SHALL 每约 12 秒轮询一次区块链,处理所有已知 campaign 的以下事件:`AllocationSet`、`Finalized`、`Claimed`、`TokenTransferred`。每个事件 SHALL 触发对应的数据库写入。

worker SHALL 把进度写入 `kv_state`(key `indexer.last_block`),通过幂等写入和 last_block 持久化,保证最终不漏事件。

#### Scenario: AllocationSet 写入 allocations 表

- **WHEN** campaign C 上观察到新的 `AllocationSet(recipient)` 事件
- **THEN** SHALL 把 `(campaign_address, recipient_address, block_number, tx_hash)` 行 INSERT 进 `allocations`
- **AND** 同一 (campaign, recipient) 的重复插入 SHALL 静默忽略(`ON CONFLICT DO NOTHING`)

#### Scenario: TokenTransferred 更新 claims 金额

- **WHEN** 在 `Claimed(user)` 之后观察到 campaign C 的 `TokenTransferred(user, amount)` 事件
- **THEN** `claims` 中 `(C, user)` 行 SHALL 被更新填入 `amount` 与 `transferred_at_block`

#### Scenario: worker 重启后续行

- **WHEN** worker 在第 N 块的 tick 中被杀,之后重启
- **THEN** 重启后第一个 tick SHALL 从 `kv_state['indexer.last_block'] + 1` 开始
- **AND** SHALL NOT 重新处理之前已处理过的块

### Requirement: 公开列表 API

后端 SHALL 暴露三个无鉴权读端点:

- `GET /api/campaigns` —— 列出所有 campaign,支持 `?status=<setup|claiming|...>` 过滤
- `GET /api/admin/<address>/campaigns` —— 列出 `admin = address` 的 campaign
- `GET /api/auditor/<address>/campaigns` —— 列出 `auditor = address` 的 campaign

地址比较 SHALL 忽略大小写。结果 SHALL 按 `created_at DESC` 排序。

#### Scenario: 按 admin 过滤

- **WHEN** `0xERNEST` 部署了 C1、C2,`0xOTHER` 部署了 C3
- **AND** 请求 `GET /api/admin/0xernest/campaigns`(小写)
- **THEN** 响应 SHALL 包含 C1 与 C2
- **AND** SHALL NOT 包含 C3

### Requirement: 草稿 CRUD 按所有者隔离

后端 SHALL 提供 SIWE 鉴权的 `POST /api/drafts`、`GET /api/drafts/:id`、`PUT /api/drafts/:id`、`DELETE /api/drafts/:id`。所有草稿 SHALL 按 `owner_address`(从 session 提取)隔离。跨所有者访问 SHALL 返回 404(不是 403)。

PUT 请求 SHALL 自增 `draft_version`,以便 wizard 检测跨 tab 编辑。

此外,PUT 请求 SHALL 支持乐观锁(optimistic locking):请求体 MAY 包含 `expectedDraftVersion` 字段。如果提供该字段且不等于数据库当前 `draft_version`,后端 SHALL 返回 `409 Conflict`,响应体 SHALL 包含当前 `draftVersion` 与 `lastUpdatedAt` 供前端展示给用户。

#### Scenario: PUT 后 version 自增

- **WHEN** `draft_version = 1` 的草稿收到一个 PUT 更新 `current_step`
- **THEN** 响应 SHALL 包含 `draftVersion: 2`
- **AND** 数据库中 `draft_version` SHALL 写入为 `2`

#### Scenario: 字段白名单

- **WHEN** PUT 请求体包含不在允许字段列表中的字段(如 `owner_address`)
- **THEN** 该字段 SHALL 被忽略
- **AND** SHALL NOT 覆盖对应列

#### Scenario: 跨 tab 编辑冲突

- **WHEN** 用户 tab1 持有 `draftVersion = 5` 的草稿状态
- **AND** 用户在 tab2 修改并保存,后端 `draft_version` 变为 `6`
- **AND** tab1 提交 PUT 请求,body 包含 `expectedDraftVersion: 5`
- **THEN** 响应 SHALL 是 `409 Conflict`
- **AND** 响应 body SHALL 包含 `{ currentDraftVersion: 6, lastUpdatedAt: <timestamp> }`
- **AND** tab1 的修改 SHALL NOT 被写入

#### Scenario: 不带 expectedDraftVersion 的 PUT 兼容旧客户端

- **WHEN** PUT 请求 body 不含 `expectedDraftVersion` 字段
- **THEN** 后端 SHALL 走原有的"无锁覆盖"路径,自增 draft_version 并返回最新 row
- **AND** 不返回 409(保留向后兼容,但前端 SHOULD 总是带 expectedDraftVersion)

### Requirement: SIWE nonce 一次性使用

后端 `POST /api/auth/siwe` 处理函数 SHALL 在签名校验通过后立即从 `siwe_nonces` 删除该 nonce。重放尝试 SHALL 以 401 失败。

#### Scenario: nonce 用一次后销毁

- **WHEN** 一条带 nonce N 的 SIWE 消息被成功校验
- **THEN** `siwe_nonces` 中对应 nonce N 的行 SHALL 被删除
- **AND** 后续重用 nonce N 的请求 SHALL 返回 `401 unknown nonce`

### Requirement: CORS 限定 dApp origin

后端 SHALL 只接受来自配置的 dApp origin(`SIWE_DOMAIN` 环境变量)的跨域请求。其他 origin SHALL 被 CORS 拒绝。

#### Scenario: 本地开发 origin

- **WHEN** `SIWE_DOMAIN = localhost:5173`,dApp 开发服务器发起带凭据请求
- **THEN** CORS 预检 SHALL 通过
- **AND** 请求 SHALL 正常进入处理流程

