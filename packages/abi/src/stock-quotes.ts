const quoteAssetConfigComponents = [
  { name: "enabled", type: "bool" },
  { name: "quoteTradingEnabled", type: "bool" },
  { name: "graduationEnabled", type: "bool" },
  { name: "priceFeed", type: "address" },
  { name: "tokenDecimals", type: "uint8" },
  { name: "maxOracleAge", type: "uint32" },
  { name: "maxOracleDeviationBps", type: "uint16" },
  { name: "maxLaunchQuoteExposure", type: "uint128" },
  { name: "maxPoolQuoteExposure", type: "uint128" },
  { name: "issuerAssetId", type: "bytes32" },
] as const;

export const stockQuoteAssetRegistryAbi = [
  {
    type: "function",
    name: "registryChainId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteAssetConfig",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "config", type: "tuple", components: quoteAssetConfigComponents },
    ],
  },
  {
    type: "event",
    name: "QuoteAssetListed",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "issuerAssetId", type: "bytes32", indexed: true },
      { name: "priceFeed", type: "address", indexed: true },
      { name: "version", type: "uint32", indexed: false },
      { name: "configurationHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteAssetConfigUpdated",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "version", type: "uint32", indexed: false },
      { name: "configurationHash", type: "bytes32", indexed: false },
      { name: "quoteTradingEnabled", type: "bool", indexed: false },
      { name: "graduationEnabled", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "QuoteAssetDisabled",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "version", type: "uint32", indexed: false },
    ],
  },
] as const;

export const stockQuoteOracleGuardAbi = [
  {
    type: "function",
    name: "sessionPolicy",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "policy",
        type: "tuple",
        components: [
          { name: "state", type: "uint8" },
          { name: "observedAt", type: "uint64" },
          { name: "multiplierX18", type: "uint128" },
          { name: "afterHoursBuyEnabled", type: "bool" },
          { name: "configured", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "validatedUsdNotional",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "operation", type: "uint8" },
      { name: "rawAmount", type: "uint256" },
    ],
    outputs: [
      {
        name: "observation",
        type: "tuple",
        components: [
          { name: "priceX18", type: "uint256" },
          { name: "notionalX18", type: "uint256" },
          { name: "updatedAt", type: "uint64" },
          { name: "roundId", type: "uint80" },
          { name: "marketState", type: "uint8" },
          { name: "multiplierX18", type: "uint128" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "validateGraduate",
    stateMutability: "view",
    inputs: [
      { name: "quoteAsset", type: "address" },
      { name: "quoteAmountRaw", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "SessionPolicyUpdated",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "state", type: "uint8", indexed: true },
      { name: "multiplierX18", type: "uint128", indexed: false },
      { name: "afterHoursBuyEnabled", type: "bool", indexed: false },
      { name: "observedAt", type: "uint64", indexed: false },
      { name: "version", type: "uint32", indexed: false },
    ],
  },
] as const;

const destinationCapabilityComponents = [
  { name: "chainId", type: "uint256" },
  { name: "quoteAsset", type: "address" },
  { name: "adapter", type: "address" },
  { name: "factory", type: "address" },
  { name: "adapterVersion", type: "uint32" },
  { name: "mode", type: "uint8" },
  { name: "adapterConfigurationHash", type: "bytes32" },
  { name: "reviewReferenceHash", type: "bytes32" },
  { name: "fundedAcceptanceHash", type: "bytes32" },
  { name: "registeredAt", type: "uint64" },
  { name: "acceptedAt", type: "uint64" },
  { name: "enabled", type: "bool" },
] as const;

export const stockQuoteDestinationRegistryAbi = [
  {
    type: "function", name: "capabilityId", stateMutability: "view",
    inputs: [{ name: "quoteAsset", type: "address" }, { name: "mode", type: "uint8" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function", name: "capability", stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ name: "value", type: "tuple", components: destinationCapabilityComponents }],
  },
  {
    type: "function", name: "isEnabled", stateMutability: "view",
    inputs: [{ name: "quoteAsset", type: "address" }, { name: "mode", type: "uint8" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "isStockQuoteAsset", stateMutability: "view",
    inputs: [{ name: "quoteAsset", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event", name: "DestinationCapabilityRegistered",
    inputs: [
      { name: "capabilityId", type: "bytes32", indexed: true },
      { name: "quoteAsset", type: "address", indexed: true },
      { name: "adapter", type: "address", indexed: true },
      { name: "mode", type: "uint8", indexed: false },
      { name: "adapterVersion", type: "uint32", indexed: false },
      { name: "factory", type: "address", indexed: false },
      { name: "adapterConfigurationHash", type: "bytes32", indexed: false },
      { name: "reviewReferenceHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event", name: "DestinationCapabilityAccepted",
    inputs: [
      { name: "capabilityId", type: "bytes32", indexed: true },
      { name: "fundedAcceptanceHash", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event", name: "DestinationCapabilityDisabled",
    inputs: [{ name: "capabilityId", type: "bytes32", indexed: true }],
  },
] as const;
