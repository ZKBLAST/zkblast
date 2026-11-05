export const assistanceFeeCollectorAbi = [
  {
    type: "event",
    name: "ProtocolFeeSourceUpdated",
    inputs: [
      { name: "sourceId", type: "bytes32", indexed: true },
      { name: "source", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "adapterId", type: "bytes32", indexed: false },
      { name: "status", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProtocolRevenueRecorded",
    inputs: [
      { name: "sourceId", type: "bytes32", indexed: true },
      { name: "epochId", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "kind", type: "uint8", indexed: false },
      { name: "grossAmount", type: "uint256", indexed: false },
      { name: "excludedObligations", type: "uint256", indexed: false },
      { name: "eligibleAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProtocolFeeAllocated",
    inputs: [
      { name: "sourceId", type: "bytes32", indexed: true },
      { name: "epochId", type: "bytes32", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "eligibleAmount", type: "uint256", indexed: false },
      { name: "buybackAmount", type: "uint256", indexed: false },
      { name: "treasuryAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "assetLedger",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "ledger",
        type: "tuple",
        components: [
          { name: "collected", type: "uint256" },
          { name: "allocatedBuyback", type: "uint256" },
          { name: "allocatedTreasury", type: "uint256" },
          { name: "spentBuyback", type: "uint256" },
          { name: "claimedTreasury", type: "uint256" },
          { name: "burnedProtocolToken", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "reconciliation",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "pendingBuyback", type: "uint256" },
      { name: "treasuryClaimable", type: "uint256" },
      { name: "liability", type: "uint256" },
      { name: "surplus", type: "uint256" },
      { name: "solvent", type: "bool" },
    ],
  },
] as const;

export const buybackRouteRegistryAbi = [
  {
    type: "function",
    name: "spendWindow",
    stateMutability: "view",
    inputs: [{ name: "routeId", type: "bytes32" }],
    outputs: [
      { name: "day", type: "uint64" },
      { name: "lastExecutionAt", type: "uint64" },
      { name: "spent", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getRoute",
    stateMutability: "view",
    inputs: [{ name: "routeId", type: "bytes32" }],
    outputs: [
      {
        name: "route",
        type: "tuple",
        components: [
          { name: "inputAsset", type: "address" },
          { name: "outputAsset", type: "address" },
          { name: "pool", type: "address" },
          { name: "router", type: "address" },
          { name: "adapter", type: "address" },
          { name: "oracle", type: "address" },
          {
            name: "limits",
            type: "tuple",
            components: [
              { name: "minimumAmount", type: "uint256" },
              { name: "maximumAmount", type: "uint256" },
              { name: "maximumDailySpend", type: "uint256" },
              { name: "minimumPoolLiquidity", type: "uint128" },
              { name: "cooldownSeconds", type: "uint32" },
              { name: "oracleStalenessSeconds", type: "uint32" },
              { name: "swapDeadlineSeconds", type: "uint32" },
              { name: "maximumSlippageBps", type: "uint16" },
              { name: "maximumPriceImpactBps", type: "uint16" },
              { name: "maximumOracleDeviationBps", type: "uint16" },
            ],
          },
          { name: "model", type: "uint8" },
          { name: "inputDecimals", type: "uint8" },
          { name: "outputDecimals", type: "uint8" },
          { name: "minimumOracleObservations", type: "uint16" },
          { name: "maximumBinCrossings", type: "uint16" },
          { name: "token0ToToken1", type: "bool" },
          { name: "enabled", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const assistanceFundExecutorAbi = [
  {
    type: "event",
    name: "BuybackExecuted",
    inputs: [
      { name: "routeId", type: "bytes32", indexed: true },
      { name: "assetIn", type: "address", indexed: true },
      { name: "protocolToken", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "referencePriceX18", type: "uint256", indexed: false },
      { name: "executionPriceX18", type: "uint256", indexed: false },
      { name: "executor", type: "address", indexed: false },
    ],
  },
  {
    type: "function",
    name: "executeBuyback",
    stateMutability: "nonpayable",
    inputs: [
      { name: "routeId", type: "bytes32" },
      { name: "amountIn", type: "uint256" },
      { name: "minimumAmountOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountBurned", type: "uint256" }],
  },
] as const;

export const treasuryControllerAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const burnModuleAbi = [
  {
    type: "event",
    name: "ProtocolTokensBurned",
    inputs: [
      { name: "protocolToken", type: "address", indexed: true },
      { name: "method", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalSupplyBefore", type: "uint256", indexed: false },
      { name: "totalSupplyAfter", type: "uint256", indexed: false },
      { name: "executor", type: "address", indexed: true },
    ],
  },
  {
    type: "function",
    name: "protocolToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "assistanceFund",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
