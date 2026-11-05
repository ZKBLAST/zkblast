export const assistanceFeeCollectorAbi = [
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
