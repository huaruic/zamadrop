// Minimum read ABI for the V7 ZamaDropCampaign contract.
// We only declare the views the indexer + register endpoint need; full
// ABI lives in the contracts package.
export const campaignAbi = [
  {
    name: "admin",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "auditor",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "token",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "recipientListHash",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "declaredTotal",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    name: "recipientCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    name: "claimedTotalPlaintext",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    name: "state",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  // Events
  {
    name: "AllocationSet",
    type: "event",
    inputs: [{ name: "recipient", type: "address", indexed: true }],
  },
  {
    name: "Finalized",
    type: "event",
    inputs: [{ name: "success", type: "bool", indexed: false }],
  },
  {
    name: "Claimed",
    type: "event",
    inputs: [{ name: "recipient", type: "address", indexed: true }],
  },
  {
    name: "TokenTransferred",
    type: "event",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "amount", type: "uint64", indexed: false },
    ],
  },
] as const;
