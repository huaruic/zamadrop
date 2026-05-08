/**
 * 合约 ABI（精简版，只保留前端需要的函数和事件）
 */

export const CAMPAIGN_ABI = [
  // 读取明文状态
  { type: "function", name: "declaredTotal", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "recipientCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "admin", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "auditor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "finalized", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "finalizeCheckHandle", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  // V7 reads
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "claimedTotalPlaintext", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "recipientListHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "allocationCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "allocationSet", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transferred", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "pendingClaimHandle", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },

  // 视图函数（返回密文 handle）
  { type: "function", name: "requestMyAllocation", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "requestClaimedTotalForAuditor", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },

  // 写入函数
  { type: "function", name: "setAllocation", stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "recipient" }, { type: "bytes32", name: "encAmount" }, { type: "bytes", name: "inputProof" }], outputs: [] },
  { type: "function", name: "setAllocationsBatch", stateMutability: "nonpayable",
    inputs: [
      { type: "address[]", name: "recipients" },
      { type: "bytes32[]", name: "encAmounts" },
      { type: "bytes", name: "inputProof" },
    ], outputs: [] },
  { type: "function", name: "finalize", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "callbackFinalize", stateMutability: "nonpayable",
    inputs: [{ type: "bool", name: "result" }, { type: "bytes", name: "decryptionProof" }], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "executeTransfer", stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "user" }, { type: "uint64", name: "amount" }, { type: "bytes", name: "decryptionProof" }], outputs: [] },
  { type: "function", name: "withdrawExcess", stateMutability: "nonpayable",
    inputs: [{ type: "uint256", name: "amount" }], outputs: [] },
  { type: "function", name: "cancelCampaign", stateMutability: "nonpayable", inputs: [], outputs: [] },

  // 事件
  { type: "event", name: "AllocationSet", inputs: [{ type: "address", indexed: true, name: "recipient" }] },
  { type: "event", name: "FinalizeRequested", inputs: [{ type: "bytes32", indexed: false, name: "checkHandle" }] },
  { type: "event", name: "Finalized", inputs: [{ type: "bool", indexed: false, name: "success" }] },
  { type: "event", name: "Claimed", inputs: [{ type: "address", indexed: true, name: "recipient" }] },
  { type: "event", name: "ClaimRequested", inputs: [{ type: "address", indexed: true, name: "user" }, { type: "bytes32", indexed: false, name: "handle" }] },
  { type: "event", name: "TokenTransferred", inputs: [{ type: "address", indexed: true, name: "user" }, { type: "uint64", indexed: false, name: "amount" }] },
  { type: "event", name: "ExcessWithdrawn", inputs: [{ type: "uint256", indexed: false, name: "amount" }, { type: "uint256", indexed: false, name: "remainingBalance" }] },
  { type: "event", name: "CampaignCancelled", inputs: [{ type: "uint256", indexed: false, name: "returnedAmount" }] },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;
