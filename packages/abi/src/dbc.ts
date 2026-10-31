import type { Abi } from "viem";

export const dbcEventsAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LaunchTemplateCreated",
    inputs: [
      { name: "templateId", type: "uint256", indexed: true },
      { name: "familyId", type: "bytes32", indexed: true },
      { name: "version", type: "uint32", indexed: true },
      { name: "configHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LaunchTemplateStatusUpdated",
    inputs: [
      { name: "templateId", type: "uint256", indexed: true },
      { name: "enabled", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "templateId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "virtualPool", type: "address", indexed: false },
      { name: "quoteToken", type: "address", indexed: false },
      { name: "baseInventoryRaw", type: "uint256", indexed: false },
      { name: "graduationThresholdRaw", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LaunchMetadataPublished",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "creatorTokenRecipient", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "CurveSwapExecuted",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "isBuy", type: "bool", indexed: false },
      { name: "amountInRaw", type: "uint256", indexed: false },
      { name: "amountOutRaw", type: "uint256", indexed: false },
      { name: "feeRaw", type: "uint256", indexed: false },
      { name: "finalPriceX18", type: "uint256", indexed: false },
      { name: "realQuoteReserveRaw", type: "uint256", indexed: false },
      { name: "baseSoldRaw", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeAccrued",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "creatorAmountRaw", type: "uint256", indexed: false },
      { name: "partnerAmountRaw", type: "uint256", indexed: false },
      { name: "protocolAmountRaw", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeClaimed",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "allocation", type: "uint8", indexed: true },
      { name: "amountRaw", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LifecycleUpdated",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "previousLifecycle", type: "uint8", indexed: false },
      { name: "nextLifecycle", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GraduationReady",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "realQuoteReserveRaw", type: "uint256", indexed: false },
      { name: "thresholdRaw", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GraduationCompleted",
    inputs: [
      { name: "migrationId", type: "bytes32", indexed: true },
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "destinationPool", type: "address", indexed: true },
      { name: "baseMigrated", type: "uint256", indexed: false },
      { name: "quoteMigrated", type: "uint256", indexed: false },
      { name: "destinationShares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllocationRegistered",
    inputs: [
      { name: "migrationId", type: "bytes32", indexed: true },
      { name: "pool", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: false },
      { name: "protocolRecipient", type: "address", indexed: false },
      { name: "creatorShares", type: "uint256", indexed: false },
      { name: "protocolShares", type: "uint256", indexed: false },
      { name: "creatorUnlockAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AllocationClaimed",
    inputs: [
      { name: "migrationId", type: "bytes32", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "creatorAllocation", type: "bool", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

export const launchConfigRegistryAbi = [
  {
    type: "function",
    name: "templateSummary",
    stateMutability: "view",
    inputs: [{ name: "templateId", type: "uint256" }],
    outputs: [
      { name: "familyId", type: "bytes32" },
      { name: "configHash", type: "bytes32" },
      { name: "version", type: "uint32" },
      { name: "enabled", type: "bool" },
      { name: "used", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "templateEconomics",
    stateMutability: "view",
    inputs: [{ name: "templateId", type: "uint256" }],
    outputs: [
      { name: "quoteToken", type: "address" },
      { name: "totalSupplyRaw", type: "uint128" },
      { name: "baseInventoryRaw", type: "uint128" },
      { name: "graduationThresholdRaw", type: "uint128" },
      { name: "destinationFeePips", type: "uint24" },
      { name: "terminalPriceToleranceBps", type: "uint16" },
      { name: "tradeFeeBps", type: "uint16" },
      { name: "creatorFeeShareBps", type: "uint16" },
      { name: "partnerFeeShareBps", type: "uint16" },
      { name: "protocolFeeShareBps", type: "uint16" },
      { name: "creatorLpShareBps", type: "uint16" },
      { name: "creatorLockSeconds", type: "uint32" },
    ],
  },
] as const satisfies Abi;

export const launchFactoryAbi = [
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "templateId", type: "uint256" },
          { name: "salt", type: "bytes32" },
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "metadataURI", type: "string" },
          { name: "creatorTokenRecipient", type: "address" },
        ],
      },
    ],
    outputs: [
      { name: "launchId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "virtualPool", type: "address" },
    ],
  },
  {
    type: "function",
    name: "launches",
    stateMutability: "view",
    inputs: [{ name: "launchId", type: "bytes32" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "token", type: "address" },
      { name: "virtualPool", type: "address" },
      { name: "templateId", type: "uint256" },
    ],
  },
] as const satisfies Abi;

const buyQuoteComponents = [
  { name: "grossQuoteConsumedRaw", type: "uint256" },
  { name: "netQuoteRaw", type: "uint256" },
  { name: "baseOutRaw", type: "uint256" },
  { name: "feeRaw", type: "uint256" },
  { name: "finalPriceX18", type: "uint256" },
] as const;

const sellQuoteComponents = [
  { name: "baseInRaw", type: "uint256" },
  { name: "grossQuoteOutRaw", type: "uint256" },
  { name: "netQuoteOutRaw", type: "uint256" },
  { name: "feeRaw", type: "uint256" },
  { name: "finalPriceX18", type: "uint256" },
] as const;

export const virtualPoolAbi = [
  {
    type: "function",
    name: "lifecycle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "graduationProgressBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteBuyExactInput",
    stateMutability: "view",
    inputs: [{ name: "grossQuoteInRaw", type: "uint256" }],
    outputs: [{ name: "quote", type: "tuple", components: buyQuoteComponents }],
  },
  {
    type: "function",
    name: "quoteSellExactInput",
    stateMutability: "view",
    inputs: [{ name: "baseInRaw", type: "uint256" }],
    outputs: [
      { name: "quote", type: "tuple", components: sellQuoteComponents },
    ],
  },
  {
    type: "function",
    name: "buyExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "grossQuoteInRaw", type: "uint256" },
      { name: "minimumBaseOutRaw", type: "uint256" },
      { name: "maximumPriceX18", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "quote", type: "tuple", components: buyQuoteComponents }],
  },
  {
    type: "function",
    name: "sellExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "baseInRaw", type: "uint256" },
      { name: "minimumQuoteOutRaw", type: "uint256" },
      { name: "minimumPriceX18", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "quote", type: "tuple", components: sellQuoteComponents },
    ],
  },
  {
    type: "function",
    name: "claimFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "allocation", type: "uint8" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const satisfies Abi;

export const graduationManagerAbi = [
  {
    type: "function",
    name: "graduate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sourcePool", type: "address" },
      { name: "adapter", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "destinationPool", type: "address" },
      { name: "destinationShares", type: "uint256" },
    ],
  },
] as const satisfies Abi;

export const lpAllocationEscrowAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "migrationId", type: "bytes32" },
      { name: "creatorAllocation", type: "bool" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const satisfies Abi;
