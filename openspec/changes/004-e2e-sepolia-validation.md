# Change 004: Sepolia 端到端验证

**状态**: DONE  
**日期**: 2026-05-02  
**目的**: 在真实 Sepolia 上跑通完整流程，验证设计文档的前提条件，留下视频素材

## 完整流程交易记录（视频素材）

| 步骤 | TxHash | Etherscan |
|------|--------|-----------|
| 1. setAllocation(deployer, 600) | `0x9a9e838e0685f3091a6c021c462523f65743b588fe91fefb54a5519a41d60e93` | [查看](https://sepolia.etherscan.io/tx/0x9a9e838e0685f3091a6c021c462523f65743b588fe91fefb54a5519a41d60e93) |
| 2. setAllocation(fake, 400) | `0x57ebd5f1af690586fd8afbe13eda91450631e57401d796dfec6cfef9923c562d` | [查看](https://sepolia.etherscan.io/tx/0x57ebd5f1af690586fd8afbe13eda91450631e57401d796dfec6cfef9923c562d) |
| 3. finalize() | `0x76c79b5299ea8da8d60c51634362b123680bdf1bac84eb6be75aa84b052f835e` | [查看](https://sepolia.etherscan.io/tx/0x76c79b5299ea8da8d60c51634362b123680bdf1bac84eb6be75aa84b052f835e) |
| 4. callbackFinalize(true) | `0x81bb156e1c5ef829211d4e028fd082476381331c93fdbaf8c1d80c518be31afb` | [查看](https://sepolia.etherscan.io/tx/0x81bb156e1c5ef829211d4e028fd082476381331c93fdbaf8c1d80c518be31afb) |
| 5. claim() | `0x6867d5f8cf3743411c38b9cde20966ea37114923796b98060566a0c112b345a9` | [查看](https://sepolia.etherscan.io/tx/0x6867d5f8cf3743411c38b9cde20966ea37114923796b98060566a0c112b345a9) |
| 6. executeTransfer(deployer, 600) | `0x70ef87a33c4ae4cd40a85081b88409da2620753516f7010cfaa2d142d2fb4639` | [查看](https://sepolia.etherscan.io/tx/0x70ef87a33c4ae4cd40a85081b88409da2620753516f7010cfaa2d142d2fb4639) |

## 设计文档前提条件验证

| 前提 | 实测结果 |
|------|---------|
| #1 Merkle 叶节点泄露金额 | 等价命题（已知）✓ |
| #2 fhEVM euint64 + FHE.add 可在 testnet 验证总和 | ✅ 实测通过，sumCheck = true |
| #3 Auditor 聚合视图差异化 | 留待 Day 5 演示 |
| #4 8 天可交付 | 进度超前 |
| #5 finalize 延迟可接受 | ✅ 实测：on-chain 12s 上链，KMS 公开解密 30~60s。**Demo 时一定要预先 finalize** |

## 实测发现

### 关键观察 1：FHE handle 在 Etherscan 上是不透明的字节
查看 setAllocation 交易的 input data：参数是 `bytes32 handle + bytes inputProof`，没有任何明文金额信息。这是隐私故事的核心证据。

### 关键观察 2：Zama KMS 公开解密在 Sepolia 上是可靠的
两次 publicDecrypt（一次 ebool 一次 euint64）都成功返回，总耗时 30~60 秒。生产环境需要前端做 loading 状态。

### 关键观察 3：claim 后 allocation 即可被任何人公开解密
这是设计选择的代价：用户 claim 后，他自己的 allocation 暴露。但**未 claim 的 fake recipient 的 allocation 仍然保密**。这正是"private until you choose to claim"的卖点。

## 演示视频脚本提示

视频高光时刻顺序：
1. 展示 Etherscan 上 setAllocation 交易，input data 是密文（5 秒）
2. 展示 finalize 交易 + Zama Gateway 解密 → "总量验证通过"（5 秒）
3. 钱包连接 → 用户看到自己的 allocation = 600（fhevmjs user re-encryption）（10 秒）
4. 点击 Claim → executeTransfer 完成 → 钱包显示 600 ZDT 到账（5 秒）
5. 切换 Auditor 视图 → 看到聚合 claimedTotal = 600，但看不到任何个人金额（5 秒）

总计 30 秒高光，剩下 90 秒讲故事和 slogan。

## 钱包余额变化

| 时点 | SepoliaETH | ZDT |
|------|-----------|-----|
| 开始 | 0.05 | 0 |
| Day 4 部署后 | 0.04999... | 0 |
| E2E 后 | 0.0499... | 600 |

钱包余额很有余量，可继续多轮测试。
