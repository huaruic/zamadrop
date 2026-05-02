# Change 002: Day 3 — Token Integration + Deploy

**状态**: DONE  
**日期**: 2026-05-02  
**结果**: 23 测试全绿（18 现有 + 5 新增），编译通过，部署脚本本地验证 OK

## 目标

为 ZamaDropCampaign 接入真实 ERC20 token 转账，并提供 Testnet 部署脚本。

## 隐私权衡

`claim()` 时把该用户的 allocation 标记为可公开解密。这泄露**该用户**的金额，但只在用户**主动 claim** 时发生。隐私故事变成"金额保密直到本人选择领取"。零泄露版本（ERC7984）作为 stretch goal。

## 任务拆分（并行）

### 波次 1（独立并行）
- [task-a-mock-token.md](task-a-mock-token.md) — 创建 MockToken ERC20
- [task-b-campaign-update.md](task-b-campaign-update.md) — ZamaDropCampaign 增加 token 集成
- [task-d-network-config.md](task-d-network-config.md) — Hardhat 网络配置 + dotenv

### 波次 2（依赖波次 1）
- task-c-deploy-script.md — 部署脚本
- task-e-test-extension.md — 测试更新和扩展
