# Frontend E2E

当前真钱包自动化采用 `Playwright + Synpress`。

## 目标

第一批仅覆盖高价值可回归路径：

- `MM1` Connect MetaMask
- `MM2` Recipient decrypt
- `MM3` Auditor decrypt
- `MM4` Reject then retry
- `MM5` Wrong-chain switch

另外补一组**无需钱包**的稳定回归：

- `role-boundaries-ui.spec.ts`

## 前置

1. 在 `frontend/` 安装依赖
2. 复制 `.env.e2e.example` 为 `.env.e2e`
3. 填写测试钱包 seed 与 password
4. 构建 Synpress 钱包缓存

缓存分两类：

- `basic.setup.ts`
  用于 `MM1 connect`
- `connected.setup.ts`
  用于 `MM2/MM3/MM4`
  这个 setup 会在构建缓存时真实打开 dApp 并完成一次连接，因此**要求前端服务已经在 `E2E_BASE_URL` 上运行**

## 运行

```bash
cd frontend
npm run e2e:wallet-cache
npm run e2e
```

构建“已连接 dApp”的缓存：

```bash
cd frontend
npm run e2e:dev

# 另一个终端
cd frontend
npm run e2e:wallet-cache:connected
```

只跑无钱包回归：

```bash
cd frontend
npm run e2e:ui-regression
```

只跑真钱包关键回归：

```bash
cd frontend
npm run e2e:wallet-regression
```

真钱包用例文件：

- `e2e/specs/metamask-connect.spec.ts`
- `e2e/specs/recipient-decrypt.spec.ts`
- `e2e/specs/auditor-decrypt.spec.ts`
- `e2e/specs/reject-signature-retry.spec.ts`

设计约定：

- `MM1` 使用 `basic.setup.ts`，显式验证真实 connect 流程
- `MM2/MM3/MM4` 使用 `connected.setup.ts`，复用已经连接 dApp 的钱包 session，把重点放在签名和业务链路
- 后续新增测试如果不以“连接钱包”为测试目标，优先复用 `testWithConnectedMetaMask`，不要每个用例都重新走 connect
- 连接流程优先使用 Synpress 官方 `metamask.connectToDapp()`；当前锁定组合 Synpress `4.1.2` + MetaMask `13.13.1` 存在 UI selector 不匹配，因此用 `e2e/utils/connectToDapp.ts` 作为兼容层
- `completeOnboarding.ts` 里的 Side Panel 规避逻辑也是版本兼容层，只用于让 wallet cache 进入可处理 dApp 请求的稳定状态
- E2E dev server 会设置 `VITE_E2E_SINGLE_WALLET=true`，禁用 EIP-6963 多 provider discovery，只暴露单一 MetaMask connector

如果钱包缓存状态异常，强制重建：

```bash
cd frontend
npx synpress ./e2e/wallet-setup --force
npx synpress ./e2e/wallet-setup-connected --force
```

## 注意

- 钱包扩展测试默认使用有界面模式，不要改成普通 headless
- 本地地址优先 `http://127.0.0.1:5173`
- MetaMask / Synpress / Playwright 版本需要一起锁定
