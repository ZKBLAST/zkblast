export const liquidityVaultUsdGAbi = [
  {
    type: "function",
    name: "openPublicPosition",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "positionId", type: "bytes32" },
          { name: "ownerCommitment", type: "bytes32" },
          { name: "marketId", type: "bytes32" },
          { name: "marginUsd", type: "uint128" },
          { name: "leverageBps", type: "uint32" },
          { name: "acceptablePriceX18", type: "uint128" },
          { name: "deadline", type: "uint64" },
          { name: "isLong", type: "bool" },
        ],
      },
    ],
    outputs: [
      {
        name: "result",
        type: "tuple",
        components: [
          { name: "lockedMarginUsd", type: "uint128" },
          { name: "positionFeeUsd", type: "uint128" },
          { name: "notionalUsd", type: "uint128" },
          { name: "executionPriceX18", type: "uint128" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "closePublicPosition",
    stateMutability: "nonpayable",
    inputs: [
      { name: "positionId", type: "bytes32" },
      { name: "payoutCommitment", type: "bytes32" },
      { name: "acceptablePriceX18", type: "uint128" },
      { name: "deadline", type: "uint64" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const shieldedPerpAdapterAbi = [
  ...[
    ["openPrivatePosition", 21],
    ["closePrivatePosition", 17],
    ["modifyPrivatePosition", 19],
  ].map(([name, count]) => ({
    type: "function" as const,
    name: name as string,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "p", type: `uint256[${count}]` },
    ],
    outputs: [],
  })),
  {
    type: "function",
    name: "claimLiquidatedResidual",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "p", type: "uint256[16]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "liquidatedResidual",
    stateMutability: "view",
    inputs: [{ name: "positionId", type: "bytes32" }],
    outputs: [{ name: "residual", type: "uint256" }],
  },
] as const;

export const perpEngineAbi = [{
  type: "function",
  name: "quoteClose",
  stateMutability: "view",
  inputs: [{ name: "positionId", type: "bytes32" }],
  outputs: [{
    name: "quote",
    type: "tuple",
    components: [
      { name: "executionPriceX18", type: "uint256" },
      { name: "closeFeeUsd", type: "uint256" },
      { name: "payoutUsd", type: "uint256" },
      { name: "realizedPnlUsd", type: "int256" },
      { name: "fundingPaymentUsd", type: "int256" },
      { name: "currentNotionalUsd", type: "uint256" },
    ],
  }],
}, {
  type: "function",
  name: "quoteModify",
  stateMutability: "view",
  inputs: [
    { name: "positionId", type: "bytes32" },
    { name: "newLeverageBps", type: "uint32" },
    { name: "externalFeeUsd", type: "uint128" },
  ],
  outputs: [{
    name: "quote",
    type: "tuple",
    components: [
      { name: "expectedLockedMarginUsd", type: "uint256" },
      { name: "notionalUsd", type: "uint256" },
      { name: "closePriceX18", type: "uint256" },
      { name: "openPriceX18", type: "uint256" },
      { name: "totalProtocolFeeUsd", type: "uint256" },
      { name: "realizedPnlUsd", type: "int256" },
      { name: "fundingPaymentUsd", type: "int256" },
    ],
  }],
}] as const;

export const perpsEventsAbi = [
  {
    type: "event",
    name: "PositionOpened",
    inputs: [
      { indexed: true, name: "positionId", type: "bytes32" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: true, name: "ownerCommitment", type: "bytes32" },
      { indexed: false, name: "isLong", type: "bool" },
      { indexed: false, name: "marginUsd", type: "uint256" },
      { indexed: false, name: "notionalUsd", type: "uint256" },
      { indexed: false, name: "baseSize", type: "uint256" },
      { indexed: false, name: "executionPriceX18", type: "uint256" },
      { indexed: false, name: "positionFeeUsd", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "PositionClosed",
    inputs: [
      { indexed: true, name: "positionId", type: "bytes32" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: true, name: "payoutCommitment", type: "bytes32" },
      { indexed: false, name: "executionPriceX18", type: "uint256" },
      { indexed: false, name: "realizedPnlUsd", type: "int256" },
      { indexed: false, name: "payoutUsd", type: "uint256" },
      { indexed: false, name: "closeFeeUsd", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "PositionLiquidated",
    inputs: [
      { indexed: true, name: "positionId", type: "bytes32" },
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: true, name: "residualCommitment", type: "bytes32" },
      { indexed: false, name: "keeper", type: "address" },
      { indexed: false, name: "executionPriceX18", type: "uint256" },
      { indexed: false, name: "realizedPnlUsd", type: "int256" },
      { indexed: false, name: "fundingPaymentUsd", type: "int256" },
      { indexed: false, name: "residualPayoutUsd", type: "uint256" },
      { indexed: false, name: "keeperRewardUsd", type: "uint256" },
      { indexed: false, name: "badDebtUsd", type: "uint256" },
    ],
  },
  ...["PublicPositionOpened", "PublicPositionClosed", "PublicPositionLiquidated"].map(
    (name) => ({
      type: "event" as const,
      name,
      inputs:
        name === "PublicPositionOpened"
          ? [
              { indexed: true, name: "positionId", type: "bytes32" },
              { indexed: true, name: "owner", type: "address" },
              { indexed: false, name: "marginUsd", type: "uint256" },
              { indexed: false, name: "reserveUsd", type: "uint256" },
              { indexed: false, name: "insuranceFeeUsd", type: "uint256" },
            ]
          : [
              { indexed: true, name: "positionId", type: "bytes32" },
              { indexed: true, name: "owner", type: "address" },
              { indexed: true, name: name === "PublicPositionClosed" ? "recipient" : "keeper", type: "address" },
              { indexed: false, name: name === "PublicPositionClosed" ? "payoutUsd" : "residualPayoutUsd", type: "uint256" },
              { indexed: false, name: name === "PublicPositionClosed" ? "insuranceFeeUsd" : "keeperRewardUsd", type: "uint256" },
              ...(name === "PublicPositionLiquidated"
                ? [{ indexed: false, name: "badDebtUsd", type: "uint256" }]
                : []),
            ],
    }),
  ),
  {
    type: "event",
    name: "FundingRateUpdated",
    inputs: [
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: false, name: "rateBpsPerHour", type: "int32" },
      { indexed: false, name: "cumulativeIndexX18", type: "int256" },
    ],
  },
  ...["MarketStatusUpdated", "MarketPauseUpdated"].map((name) => ({
    type: "event" as const,
    name,
    inputs: [
      { indexed: true, name: "marketId", type: "bytes32" },
      { indexed: false, name: name === "MarketStatusUpdated" ? "enabled" : "paused", type: "bool" },
    ],
  })),
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { indexed: true, name: "sender", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "assets", type: "uint256" },
      { indexed: false, name: "shares", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Redeemed",
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "assets", type: "uint256" },
      { indexed: false, name: "shares", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "InsuranceFunded",
    inputs: [
      { indexed: true, name: "sender", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "InsuranceCovered",
    inputs: [
      { indexed: true, name: "recipient", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
] as const;
