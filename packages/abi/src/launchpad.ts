import { parseAbi, type Abi } from "viem";

export const launchpadEventsAbi = parseAbi([
  "event LaunchpadCreated(uint256 indexed launchpadId,address indexed owner,address indexed treasury,bytes32 metadataHash,bytes32 slugCommitment,uint256 configPresetId,uint32 version)",
  "event LaunchpadMetadataUpdated(uint256 indexed launchpadId,bytes32 previousMetadataHash,bytes32 metadataHash,uint32 version)",
  "event LaunchpadOperatorUpdated(uint256 indexed launchpadId,address indexed previousOperator,address indexed operator)",
  "event LaunchpadOwnerProposed(uint256 indexed launchpadId,address indexed owner,address indexed pendingOwner)",
  "event LaunchpadOwnerProposalCancelled(uint256 indexed launchpadId,address indexed owner)",
  "event LaunchpadOwnerAccepted(uint256 indexed launchpadId,address indexed previousOwner,address indexed owner)",
  "event LaunchpadTreasuryProposed(uint256 indexed launchpadId,address indexed treasury,address indexed pendingTreasury)",
  "event LaunchpadTreasuryProposalCancelled(uint256 indexed launchpadId,address indexed treasury)",
  "event LaunchpadTreasuryAccepted(uint256 indexed launchpadId,address indexed previousTreasury,address indexed treasury)",
  "event LaunchpadStatusUpdated(uint256 indexed launchpadId,uint8 previousStatus,uint8 status)",
  "event FeePolicySnapshotted(bytes32 indexed snapshotId,uint256 indexed launchpadId,address indexed pool,uint32 policyVersion)",
  "event RevenueSnapshotRegistered(bytes32 indexed snapshotId,uint256 indexed launchpadId,address indexed pool,address asset)",
  "event AuthorizationCommitmentUpdated(bytes32 indexed snapshotId,address indexed recipient,bytes32 indexed commitment)",
  "event ProofClaimVerified(bytes32 indexed snapshotId,address indexed recipient,bytes32 indexed nullifier,uint256 amount,uint256 verifierVersion)",
]);

export const launchpadFeePolicyEventsAbi = [
  {
    type: "event",
    name: "LaunchpadFeePolicyUpdated",
    inputs: [
      { name: "launchpadId", type: "uint256", indexed: true },
      { name: "version", type: "uint32", indexed: true },
      { name: "totalTradeFeeBps", type: "uint16", indexed: false },
      {
        name: "shares",
        type: "tuple",
        indexed: false,
        components: [
          { name: "protocolShareBps", type: "uint16" },
          { name: "operatorShareBps", type: "uint16" },
          { name: "creatorShareBps", type: "uint16" },
          { name: "referralShareBps", type: "uint16" },
        ],
      },
      { name: "operatorRecipient", type: "address", indexed: false },
    ],
  },
] as const satisfies Abi;

export const launchpadFactoryAbi = [
  {
    type: "function",
    name: "createLaunchpad",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "treasury", type: "address" },
      { name: "metadataHash", type: "bytes32" },
      { name: "slugCommitment", type: "bytes32" },
      { name: "configPresetId", type: "uint256" },
    ],
    outputs: [{ name: "launchpadId", type: "uint256" }],
  },
] as const satisfies Abi;

export const launchpadRegistryAbi = [
  {
    type: "function",
    name: "launchpadCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "launchpad",
    stateMutability: "view",
    inputs: [{ name: "launchpadId", type: "uint256" }],
    outputs: [
      {
        name: "record",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "pendingOwner", type: "address" },
          { name: "treasury", type: "address" },
          { name: "pendingTreasury", type: "address" },
          { name: "operator", type: "address" },
          { name: "metadataHash", type: "bytes32" },
          { name: "slugCommitment", type: "bytes32" },
          { name: "configPresetId", type: "uint256" },
          { name: "version", type: "uint32" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "launchpads",
    stateMutability: "view",
    inputs: [{ name: "launchpadIds", type: "uint256[]" }],
    outputs: [
      {
        name: "records",
        type: "tuple[]",
        components: [
          { name: "owner", type: "address" },
          { name: "pendingOwner", type: "address" },
          { name: "treasury", type: "address" },
          { name: "pendingTreasury", type: "address" },
          { name: "operator", type: "address" },
          { name: "metadataHash", type: "bytes32" },
          { name: "slugCommitment", type: "bytes32" },
          { name: "configPresetId", type: "uint256" },
          { name: "version", type: "uint32" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "LaunchpadCreated",
    inputs: [
      { name: "launchpadId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "treasury", type: "address", indexed: true },
      { name: "metadataHash", type: "bytes32", indexed: false },
      { name: "slugCommitment", type: "bytes32", indexed: false },
      { name: "configPresetId", type: "uint256", indexed: false },
      { name: "version", type: "uint32", indexed: false },
    ],
  },
] as const satisfies Abi;

const launchpadPresetComponents = [
  { name: "familyId", type: "bytes32" },
  { name: "configHash", type: "bytes32" },
  { name: "dbcTemplateId", type: "uint256" },
  { name: "quoteToken", type: "address" },
  { name: "maximumTotalTradeFeeBps", type: "uint16" },
  { name: "graduationDestination", type: "uint8" },
  { name: "creatorAccess", type: "uint8" },
  { name: "maximumLaunches", type: "uint32" },
  { name: "version", type: "uint32" },
  { name: "enabled", type: "bool" },
  { name: "used", type: "bool" },
] as const;

export const launchpadConfigManagerAbi = [
  {
    type: "function",
    name: "destinationSupported",
    stateMutability: "view",
    inputs: [{ name: "destination", type: "uint8" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "presetCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "globalMaximumTotalTradeFeeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "preset",
    stateMutability: "view",
    inputs: [{ name: "presetId", type: "uint256" }],
    outputs: [
      { name: "item", type: "tuple", components: launchpadPresetComponents },
    ],
  },
  {
    type: "function",
    name: "presets",
    stateMutability: "view",
    inputs: [{ name: "presetIds", type: "uint256[]" }],
    outputs: [
      { name: "items", type: "tuple[]", components: launchpadPresetComponents },
    ],
  },
] as const satisfies Abi;

export const launchpadRevenueSplitterAbi = [
  {
    type: "event",
    name: "FeeAccrued",
    inputs: [
      { name: "snapshotId", type: "bytes32", indexed: true },
      { name: "launchpadId", type: "uint256", indexed: true },
      { name: "asset", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: false },
      { name: "kind", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "protocolAmount", type: "uint256", indexed: false },
      { name: "operatorAmount", type: "uint256", indexed: false },
      { name: "creatorAmount", type: "uint256", indexed: false },
      { name: "referralAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeeClaimed",
    inputs: [
      { name: "snapshotId", type: "bytes32", indexed: true },
      { name: "launchpadId", type: "uint256", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: false },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableBySnapshot",
    stateMutability: "view",
    inputs: [
      { name: "snapshotId", type: "bytes32" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "accruedByKind",
    stateMutability: "view",
    inputs: [
      { name: "snapshotId", type: "bytes32" },
      { name: "kind", type: "uint8" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "reconciliation",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "liability", type: "uint256" },
      { name: "surplus", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "snapshotId", type: "bytes32" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const satisfies Abi;

export const launchpadProofClaimAdapterAbi = [
  {
    type: "function",
    name: "setAuthorizationCommitment",
    stateMutability: "nonpayable",
    inputs: [
      { name: "snapshotId", type: "bytes32" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimWithProof",
    stateMutability: "nonpayable",
    inputs: [
      { name: "proof", type: "bytes" },
      { name: "inputs", type: "uint256[15]" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "nullifierSpent",
    stateMutability: "view",
    inputs: [{ name: "nullifier", type: "bytes32" }],
    outputs: [{ name: "spent", type: "bool" }],
  },
] as const satisfies Abi;

export const launchpadFeeControllerAbi = [
  {
    type: "function",
    name: "setLaunchpadFeePolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "launchpadId", type: "uint256" },
      { name: "totalTradeFeeBps", type: "uint16" },
      {
        name: "shares",
        type: "tuple",
        components: [
          { name: "protocolShareBps", type: "uint16" },
          { name: "operatorShareBps", type: "uint16" },
          { name: "creatorShareBps", type: "uint16" },
          { name: "referralShareBps", type: "uint16" },
        ],
      },
      { name: "operatorRecipient", type: "address" },
    ],
    outputs: [],
  },
] as const satisfies Abi;

export const launchpadTokenFactoryAbi = [
  {
    type: "function",
    name: "BINDING_SCHEMA_VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint16" }],
  },
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "launchpadId", type: "uint256" },
          {
            name: "dbc",
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
          { name: "referralRecipient", type: "address" },
        ],
      },
    ],
    outputs: [
      { name: "launchId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "virtualPool", type: "address" },
      { name: "feeSnapshotId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "createProtectedLaunch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "launchpadId", type: "uint256" },
      { name: "protectedFactoryCall", type: "bytes" },
      { name: "referralRecipient", type: "address" },
    ],
    outputs: [
      { name: "launchId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "virtualPool", type: "address" },
      { name: "feeSnapshotId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "binding",
    stateMutability: "view",
    inputs: [{ name: "launchId", type: "bytes32" }],
    outputs: [
      {
        name: "item",
        type: "tuple",
        components: [
          { name: "launchpadId", type: "uint256" },
          { name: "configPresetId", type: "uint256" },
          { name: "configHash", type: "bytes32" },
          { name: "feeSnapshotId", type: "bytes32" },
          { name: "creator", type: "address" },
          { name: "treasury", type: "address" },
          { name: "token", type: "address" },
          { name: "virtualPool", type: "address" },
          { name: "graduationDestination", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "LaunchpadTokenBound",
    inputs: [
      { name: "launchId", type: "bytes32", indexed: true },
      { name: "launchpadId", type: "uint256", indexed: true },
      { name: "feeSnapshotId", type: "bytes32", indexed: true },
      { name: "bindingSchemaVersion", type: "uint16", indexed: false },
      { name: "creator", type: "address", indexed: false },
      { name: "treasury", type: "address", indexed: false },
      { name: "token", type: "address", indexed: false },
      { name: "virtualPool", type: "address", indexed: false },
      { name: "configPresetId", type: "uint256", indexed: false },
      { name: "configHash", type: "bytes32", indexed: false },
      { name: "graduationDestination", type: "uint8", indexed: false },
    ],
  },
] as const satisfies Abi;

export const launchpadFeeCollectorAbi = [
  {
    type: "function",
    name: "collectTradeFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "pool", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
] as const satisfies Abi;
