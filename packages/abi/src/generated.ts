// Generated from Foundry artifacts. Do not edit by hand.

export const poolRegistryAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "idByPool",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "initialFactory",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isRegisteredPool",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "poolById",
    inputs: [
      {
        name: "poolId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "poolCount",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerPool",
    inputs: [
      {
        name: "poolId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
      {
        name: "key",
        type: "tuple",
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "PoolRegistered",
    inputs: [
      {
        name: "poolId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "key",
        type: "tuple",
        indexed: false,
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPool",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "PoolAlreadyRegistered",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const poolFactoryAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createDlmmPool",
    inputs: [
      {
        name: "tokenA",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenB",
        type: "address",
        internalType: "address",
      },
      {
        name: "feePips",
        type: "uint24",
        internalType: "uint24",
      },
      {
        name: "binStepBps",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "initialActiveBin",
        type: "int24",
        internalType: "int24",
      },
    ],
    outputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createPool",
    inputs: [
      {
        name: "tokenA",
        type: "address",
        internalType: "address",
      },
      {
        name: "tokenB",
        type: "address",
        internalType: "address",
      },
      {
        name: "model",
        type: "uint8",
        internalType: "enum PoolModel",
      },
      {
        name: "feePips",
        type: "uint24",
        internalType: "uint24",
      },
      {
        name: "binStepBps",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "permissionlessCreation",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "predictDlmmPoolAddress",
    inputs: [
      {
        name: "key",
        type: "tuple",
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "administrator",
        type: "address",
        internalType: "address",
      },
      {
        name: "initialActiveBin",
        type: "int24",
        internalType: "int24",
      },
    ],
    outputs: [
      {
        name: "predicted",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "predictPoolAddress",
    inputs: [
      {
        name: "key",
        type: "tuple",
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "administrator",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "predicted",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "DlmmPoolInitialized",
    inputs: [
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "initialActiveBin",
        type: "int24",
        indexed: false,
        internalType: "int24",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PoolCreated",
    inputs: [
      {
        name: "poolId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "key",
        type: "tuple",
        indexed: false,
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "IdenticalTokens",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidToken",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "PoolAlreadyExists",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const dammPoolAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "key",
        type: "tuple",
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "administrator_",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "MINIMUM_LIQUIDITY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "PROTOCOL_FEE_SHARE_DENOMINATOR",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "addLiquidity",
    inputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "administrator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collectProtocolFees",
    inputs: [],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feePips",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFeeRecipient",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFeeSharePips",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFees0",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFees1",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "removeLiquidity",
    inputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reserve0",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint112",
        internalType: "uint112",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reserve1",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint112",
        internalType: "uint112",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [
      {
        name: "paused_",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setProtocolFeeConfiguration",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "sharePips",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sharesOf",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "swapExactInput",
    inputs: [
      {
        name: "tokenIn",
        type: "address",
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "token0",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token1",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalShares",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "LiquidityAdded",
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LiquidityRemoved",
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PauseUpdated",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtocolFeeConfigurationUpdated",
    inputs: [
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sharePips",
        type: "uint24",
        indexed: false,
        internalType: "uint24",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtocolFeesCollected",
    inputs: [
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "tokenIn",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amountOut",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "protocolFee",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "DeadlineExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "DivisionByZero",
    inputs: [],
  },
  {
    type: "error",
    name: "EmptyReserve",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientInput",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAdministrator",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFee",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidProtocolFeeShare",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidRecipient",
    inputs: [],
  },
  {
    type: "error",
    name: "MultiplicationOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "PoolPaused",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SlippageExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
] as const;

export const dlmmPoolAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "key",
        type: "tuple",
        internalType: "struct PoolKey",
        components: [
          {
            name: "token0",
            type: "address",
            internalType: "address",
          },
          {
            name: "token1",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "enum PoolModel",
          },
          {
            name: "feePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "binStepBps",
            type: "uint16",
            internalType: "uint16",
          },
        ],
      },
      {
        name: "administrator_",
        type: "address",
        internalType: "address",
      },
      {
        name: "initialActiveBin",
        type: "int24",
        internalType: "int24",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "MINIMUM_BIN_LIQUIDITY",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeBin",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "int24",
        internalType: "int24",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "addLiquidity",
    inputs: [
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "administrator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "binState",
    inputs: [
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
    ],
    outputs: [
      {
        name: "reserve0",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "reserve1",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "totalShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "priceX18",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "binStepBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collectProtocolFees",
    inputs: [],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feePips",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "model",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum PoolModel",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFeeRecipient",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFeeSharePips",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFees0",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protocolFees1",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "removeLiquidity",
    inputs: [
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAdministrator",
    inputs: [
      {
        name: "administrator_",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [
      {
        name: "paused_",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setProtocolFeeConfiguration",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "sharePips",
        type: "uint24",
        internalType: "uint24",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sharesOf",
    inputs: [
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "swapExactInput",
    inputs: [
      {
        name: "token0ToToken1",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumBinCrossings",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amountConsumed",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "token0",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token1",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "ActiveBinUpdated",
    inputs: [
      {
        name: "activeBin",
        type: "int24",
        indexed: true,
        internalType: "int24",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AdministratorUpdated",
    inputs: [
      {
        name: "previousAdministrator",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "administrator",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BinLiquidityAdded",
    inputs: [
      {
        name: "binId",
        type: "int24",
        indexed: true,
        internalType: "int24",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BinLiquidityRemoved",
    inputs: [
      {
        name: "binId",
        type: "int24",
        indexed: true,
        internalType: "int24",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PauseUpdated",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtocolFeeConfigurationUpdated",
    inputs: [
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sharePips",
        type: "uint24",
        indexed: false,
        internalType: "uint24",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtocolFeesCollected",
    inputs: [
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "token0ToToken1",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "amountIn",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amountOut",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "protocolFee",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "finalActiveBin",
        type: "int24",
        indexed: false,
        internalType: "int24",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "BinOutOfRange",
    inputs: [],
  },
  {
    type: "error",
    name: "DeadlineExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "DivisionByZero",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAdministrator",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidBin",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidBinStep",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidRecipient",
    inputs: [],
  },
  {
    type: "error",
    name: "MultiplicationOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "PoolPaused",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SlippageExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "TraversalLimitReached",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
] as const;

export const poolQuoterAbi = [
  {
    type: "function",
    name: "quoteDammExactInput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract DammPool",
      },
      {
        name: "tokenIn",
        type: "address",
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "feeAmount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteDlmmExactInput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract DlmmPool",
      },
      {
        name: "token0ToToken1",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumBinCrossings",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "finalBin",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "binsCrossed",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "DivisionByZero",
    inputs: [],
  },
  {
    type: "error",
    name: "EmptyReserve",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientLiquidity",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFee",
    inputs: [],
  },
  {
    type: "error",
    name: "MultiplicationOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "TraversalLimitReached",
    inputs: [],
  },
] as const;

export const swapRouterAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swapDammExactInput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract DammPool",
      },
      {
        name: "tokenIn",
        type: "address",
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "swapDlmmExactInput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract DlmmPool",
      },
      {
        name: "token0ToToken1",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "amountIn",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmountOut",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumBinCrossings",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amountOut",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "SwapRouted",
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amountIn",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amountOut",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPool",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const positionManagerAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createDammPosition",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract DammPool",
      },
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "positionId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createDlmmPosition",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract DlmmPool",
      },
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "positionId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decreasePosition",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "increasePosition",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "sharesAdded",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry_",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nextPositionId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "positions",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
      {
        name: "model",
        type: "uint8",
        internalType: "enum PoolModel",
      },
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferPosition",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "nextOwner",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "PositionCreated",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "model",
        type: "uint8",
        indexed: false,
        internalType: "enum PoolModel",
      },
      {
        name: "binId",
        type: "int24",
        indexed: false,
        internalType: "int24",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionDecreased",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sharesRemoved",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionIncreased",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "sharesAdded",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "totalShares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PositionTransferred",
    inputs: [
      {
        name: "positionId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "previousOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "nextOwner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPool",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPosition",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnauthorizedPosition",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const zkBlastVaultAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accountedAssets",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "liquid",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "managed",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "liability",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "solvent",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "assetConfig",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "denomination",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "commitmentInserted",
    inputs: [
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "inserted",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "leafIndex",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "newRoot",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "divestAggregateLiquidity",
    inputs: [
      {
        name: "manager",
        type: "address",
        internalType: "contract ShieldedLPManager",
      },
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "fieldHasher",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IFieldHasher",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "stateRegistry_",
        type: "address",
        internalType: "contract ShieldedStateRegistry",
      },
      {
        name: "fieldHasher_",
        type: "address",
        internalType: "contract IFieldHasher",
      },
      {
        name: "emptyLeaf",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "treeVersion_",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "investAggregateLiquidity",
    inputs: [
      {
        name: "manager",
        type: "address",
        internalType: "contract ShieldedLPManager",
      },
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "liabilityRaw",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "liability",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lpManagerForAsset",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "manager",
        type: "address",
        internalType: "contract ShieldedLPManager",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextLeafIndex",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "root",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setAssetConfig",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "denomination",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLPManager",
    inputs: [
      {
        name: "manager",
        type: "address",
        internalType: "contract ShieldedLPManager",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [
      {
        name: "paused_",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setWithdrawalAdapter",
    inputs: [
      {
        name: "adapter",
        type: "address",
        internalType: "contract WithdrawalVerifierAdapter",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "stateRegistry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ShieldedStateRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "treeVersion",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      {
        name: "proof",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "inputs",
        type: "uint256[13]",
        internalType: "uint256[13]",
      },
    ],
    outputs: [
      {
        name: "nullifier",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawalAdapter",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract WithdrawalVerifierAdapter",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AggregateLiquidityDivested",
    inputs: [
      {
        name: "manager",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AggregateLiquidityInvested",
    inputs: [
      {
        name: "manager",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AssetConfigUpdated",
    inputs: [
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "denomination",
        type: "uint128",
        indexed: false,
        internalType: "uint128",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CommitmentDeposited",
    inputs: [
      {
        name: "depositor",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "commitment",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "leafIndex",
        type: "uint32",
        indexed: false,
        internalType: "uint32",
      },
      {
        name: "root",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "treeVersion",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LPManagerUpdated",
    inputs: [
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "manager",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "NoteWithdrawn",
    inputs: [
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "nullifier",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "relayer",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "relayerFee",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "root",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "treeVersion",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PauseUpdated",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "WithdrawalAdapterUpdated",
    inputs: [
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AllowanceMustMatchAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "AssetNotAllowed",
    inputs: [],
  },
  {
    type: "error",
    name: "CommitmentAlreadyExists",
    inputs: [],
  },
  {
    type: "error",
    name: "InsolventAsset",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidCommitment",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidDenomination",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidWithdrawalContext",
    inputs: [],
  },
  {
    type: "error",
    name: "LPManagerUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "TreeAlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "TreeFull",
    inputs: [],
  },
  {
    type: "error",
    name: "TreeNotInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
  {
    type: "error",
    name: "VaultPaused",
    inputs: [],
  },
  {
    type: "error",
    name: "WithdrawalUnavailable",
    inputs: [],
  },
] as const;

export const shieldedStateRegistryAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "ROOT_HISTORY_SIZE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authorizedConsumer",
    inputs: [
      {
        name: "consumer",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authorizedVault",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "consumeNullifierFor",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "treeVersion",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "root",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "nullifier",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isKnownRoot",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "treeVersion",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "root",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isNullifierSpent",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "treeVersion",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "nullifier",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerRoot",
    inputs: [
      {
        name: "treeVersion",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "root",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rootAt",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "treeVersion",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "slot",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setConsumerAuthorization",
    inputs: [
      {
        name: "consumer",
        type: "address",
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setVaultAuthorization",
    inputs: [
      {
        name: "vault",
        type: "address",
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "ConsumerAuthorizationUpdated",
    inputs: [
      {
        name: "consumer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "NullifierConsumed",
    inputs: [
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "treeVersion",
        type: "uint64",
        indexed: true,
        internalType: "uint64",
      },
      {
        name: "nullifier",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RootRegistered",
    inputs: [
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "treeVersion",
        type: "uint64",
        indexed: true,
        internalType: "uint64",
      },
      {
        name: "root",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "VaultAuthorizationUpdated",
    inputs: [
      {
        name: "vault",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFieldElement",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "NullifierAlreadySpent",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnauthorizedConsumer",
    inputs: [],
  },
  {
    type: "error",
    name: "UnauthorizedVault",
    inputs: [],
  },
  {
    type: "error",
    name: "UnknownRoot",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const shieldedLPManagerAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "vault_",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry",
        type: "address",
        internalType: "contract PoolRegistry",
      },
      {
        name: "pool_",
        type: "address",
        internalType: "contract DammPool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "administrator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "divest",
    inputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "emergencyExit",
    inputs: [
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "invest",
    inputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "sharesAdded",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "managedShares",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pool",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract DammPool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewAssets",
    inputs: [],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [
      {
        name: "paused_",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "token0",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token1",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vault",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AggregatePositionDecreased",
    inputs: [
      {
        name: "sharesRemoved",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "AggregatePositionIncreased",
    inputs: [
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "sharesAdded",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EmergencyExit",
    inputs: [
      {
        name: "sharesRemoved",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PauseUpdated",
    inputs: [
      {
        name: "paused",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "DivisionByZero",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidShareAmount",
    inputs: [],
  },
  {
    type: "error",
    name: "ManagerPaused",
    inputs: [],
  },
  {
    type: "error",
    name: "MultiplicationOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "UnauthorizedAdministrator",
    inputs: [],
  },
  {
    type: "error",
    name: "UnauthorizedVault",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
] as const;

export const privateVaultV2Abi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_INTENT_LIFETIME",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "actionVerifier",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPrivateActionVerifierV2",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "actionsPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "assetEnabled",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "commitmentInserted",
    inputs: [
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "inserted",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "consumePerpsNote",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "treeVersion_",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "root",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "nullifier",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "currentRoot",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      {
        name: "proof",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "p",
        type: "uint256[11]",
        internalType: "uint256[11]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositsPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fieldHasher",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IFieldHasher",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fundVerifier",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IPrivateFundVerifierV2",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "registry",
        type: "address",
        internalType: "contract PoolRegistry",
      },
      {
        name: "hasher",
        type: "address",
        internalType: "contract IFieldHasher",
      },
      {
        name: "actionVerifier_",
        type: "address",
        internalType: "contract IPrivateActionVerifierV2",
      },
      {
        name: "fundVerifier_",
        type: "address",
        internalType: "contract IPrivateFundVerifierV2",
      },
      {
        name: "treeVersion_",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "insertPerpsNote",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "payer",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "intentStatus",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum IntentLifecycleV2.Status",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isKnownRoot",
    inputs: [
      {
        name: "root",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "liabilityRaw",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "liability",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextLeafIndex",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nullifierIntent",
    inputs: [
      {
        name: "nullifier",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "intentId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "perpsAdapterAuthorized",
    inputs: [
      {
        name: "adapter",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "poolRegistry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract PoolRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "refund",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reservation",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct IntentLifecycleV2.Reservation",
        components: [
          {
            name: "statementHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "nullifiers",
            type: "bytes32[3]",
            internalType: "bytes32[3]",
          },
          {
            name: "settlementCommitments",
            type: "bytes32[3]",
            internalType: "bytes32[3]",
          },
          {
            name: "refundCommitments",
            type: "bytes32[3]",
            internalType: "bytes32[3]",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reserve",
    inputs: [
      {
        name: "terms",
        type: "tuple",
        internalType: "struct SettlementTermsV2.Terms",
        components: [
          {
            name: "chainId",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "settlement",
            type: "address",
            internalType: "address",
          },
          {
            name: "action",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "pool",
            type: "address",
            internalType: "address",
          },
          {
            name: "model",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "binId",
            type: "int24",
            internalType: "int24",
          },
          {
            name: "asset0",
            type: "address",
            internalType: "address",
          },
          {
            name: "asset1",
            type: "address",
            internalType: "address",
          },
          {
            name: "amount0",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "amount1",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "shares",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minimum0",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minimum1",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minimumShares",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "maximumFee0",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "maximumFee1",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "feeRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "refundCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "outputCommitment0",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "outputCommitment1",
            type: "bytes32",
            internalType: "bytes32",
          },
        ],
      },
      {
        name: "inputs",
        type: "uint256[32]",
        internalType: "uint256[32]",
      },
      {
        name: "maximumBinCrossings",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "proof",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "intentId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAssetEnabled",
    inputs: [
      {
        name: "asset",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [
      {
        name: "deposits",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "actions",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "withdrawals",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPerpsAdapterAuthorization",
    inputs: [
      {
        name: "adapter",
        type: "address",
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settle",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "statement",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleBatch",
    inputs: [
      {
        name: "intentIds",
        type: "bytes32[]",
        internalType: "bytes32[]",
      },
      {
        name: "statements",
        type: "bytes[]",
        internalType: "bytes[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "shareLiability",
    inputs: [
      {
        name: "resource",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "liability",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "shareResource",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
      {
        name: "model",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "bin",
        type: "int24",
        internalType: "int24",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "treeVersion",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      {
        name: "proof",
        type: "bytes",
        internalType: "bytes",
      },
      {
        name: "p",
        type: "uint256[11]",
        internalType: "uint256[11]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawalSpent",
    inputs: [
      {
        name: "nullifier",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "spent",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "withdrawalsPaused",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AssetEnabled",
    inputs: [
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "commitment",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "IntentRefunded",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "IntentReserved",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "deadline",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "IntentSettled",
    inputs: [
      {
        name: "intentId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "NoteInserted",
    inputs: [
      {
        name: "commitment",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "leafIndex",
        type: "uint32",
        indexed: false,
        internalType: "uint32",
      },
      {
        name: "root",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PauseUpdated",
    inputs: [
      {
        name: "deposits",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "actions",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "withdrawals",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PerpsAdapterAuthorizationUpdated",
    inputs: [
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "authorized",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PerpsNoteConsumed",
    inputs: [
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "nullifier",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PerpsNoteInserted",
    inputs: [
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "commitment",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      {
        name: "asset",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "nullifier",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "ActualDeltaMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "AssetUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "Insolvent",
    inputs: [],
  },
  {
    type: "error",
    name: "IntentExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidCommitment",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidExecutionBounds",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidExecutionContext",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFundContext",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFundProof",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidIntentState",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidProof",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidProofContext",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidReservation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidTerms",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "NoteUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "NullifierUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "Paused",
    inputs: [],
  },
  {
    type: "error",
    name: "PoolIdentityMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "RefundNotAvailable",
    inputs: [],
  },
  {
    type: "error",
    name: "StatementMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "TreeAlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "TreeFull",
    inputs: [],
  },
  {
    type: "error",
    name: "TreeNotInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnregisteredPool",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const launchProtectionPolicyRegistryAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "BPS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_LAUNCH_FEE_BPS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_LP_LOCK_SECONDS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_PROTECTION_BLOCKS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "POLICY_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "POLICY_CONSUMER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createPolicy",
    inputs: [
      {
        name: "input",
        type: "tuple",
        internalType: "struct LaunchProtectionPolicyRegistry.PolicyInput",
        components: [
          {
            name: "familyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "protectionBlocks",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "maxBuyBpsPerTransaction",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "maxBuyBpsPerAddress",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "initialFeeBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "baseFeeBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "lpLockSeconds",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "batchMode",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "policyAdmin",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "latestVersion",
    inputs: [
      {
        name: "familyId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "version",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "markPolicyUsed",
    inputs: [
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "policy",
    inputs: [
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct LaunchProtectionPolicyRegistry.Policy",
        components: [
          {
            name: "familyId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "protectionBlocks",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "maxBuyBpsPerTransaction",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "maxBuyBpsPerAddress",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "initialFeeBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "baseFeeBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "lpLockSeconds",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "version",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "batchMode",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "enabled",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "used",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyCount",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setPolicyEnabled",
    inputs: [
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "ProtectionPolicyCreated",
    inputs: [
      {
        name: "policyId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "familyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "version",
        type: "uint32",
        indexed: true,
        internalType: "uint32",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtectionPolicyStatusUpdated",
    inputs: [
      {
        name: "policyId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtectionPolicyUsed",
    inputs: [
      {
        name: "policyId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPolicy",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "PolicyNotFound",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const protectedLaunchFactoryAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "LAUNCHPAD_FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "LAUNCH_MODE_PROTECTED",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "configurePoolGraduationManager",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "manager",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createLaunch",
    inputs: [
      {
        name: "request",
        type: "tuple",
        internalType: "struct ProtectedLaunchFactory.LaunchRequest",
        components: [
          {
            name: "templateId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "policyId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "name",
            type: "string",
            internalType: "string",
          },
          {
            name: "symbol",
            type: "string",
            internalType: "string",
          },
          {
            name: "metadataURI",
            type: "string",
            internalType: "string",
          },
          {
            name: "creatorTokenRecipient",
            type: "address",
            internalType: "address",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "virtualPool",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createLaunchFor",
    inputs: [
      {
        name: "request",
        type: "tuple",
        internalType: "struct ProtectedLaunchFactory.LaunchRequest",
        components: [
          {
            name: "templateId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "policyId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "salt",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "deadline",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "name",
            type: "string",
            internalType: "string",
          },
          {
            name: "symbol",
            type: "string",
            internalType: "string",
          },
          {
            name: "metadataURI",
            type: "string",
            internalType: "string",
          },
          {
            name: "creatorTokenRecipient",
            type: "address",
            internalType: "address",
          },
        ],
      },
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "feeCollector",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "virtualPool",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "graduationManager",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "identityRegistry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ProtectedLaunchIdentityRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "templateRegistry_",
        type: "address",
        internalType: "contract LaunchConfigRegistry",
      },
      {
        name: "policyRegistry_",
        type: "address",
        internalType: "contract LaunchProtectionPolicyRegistry",
      },
      {
        name: "tokenDeployer_",
        type: "address",
        internalType: "contract ProtectedLaunchTokenDeployer",
      },
      {
        name: "poolDeployer_",
        type: "address",
        internalType: "contract ProtectedVirtualPoolDeployer",
      },
      {
        name: "identityRegistry_",
        type: "address",
        internalType: "contract ProtectedLaunchIdentityRegistry",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "launchByPool",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchByToken",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchCount",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchIdentifier",
    inputs: [
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "templateId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launches",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
      {
        name: "virtualPool",
        type: "address",
        internalType: "address",
      },
      {
        name: "templateId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "protectionStartBlock",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyRegistry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract LaunchProtectionPolicyRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "poolDeployer",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ProtectedVirtualPoolDeployer",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setGraduationManager",
    inputs: [
      {
        name: "manager",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPoolPaused",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "paused",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "templateRegistry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract LaunchConfigRegistry",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenDeployer",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ProtectedLaunchTokenDeployer",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "ProtectedLaunchMetadataPublished",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "name",
        type: "string",
        indexed: false,
        internalType: "string",
      },
      {
        name: "symbol",
        type: "string",
        indexed: false,
        internalType: "string",
      },
      {
        name: "metadataURI",
        type: "string",
        indexed: false,
        internalType: "string",
      },
      {
        name: "creatorTokenRecipient",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtectedTokenLaunched",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "templateId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "policyId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "creator",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "token",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "virtualPool",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "quoteToken",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "protectionStartBlock",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidLaunch",
    inputs: [],
  },
  {
    type: "error",
    name: "LaunchAlreadyExists",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "PolicyUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "TemplateUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const protectedLaunchTokenAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "name_",
        type: "string",
        internalType: "string",
      },
      {
        name: "symbol_",
        type: "string",
        internalType: "string",
      },
      {
        name: "metadataURI_",
        type: "string",
        internalType: "string",
      },
      {
        name: "totalSupply_",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "initialHolder",
        type: "address",
        internalType: "address",
      },
      {
        name: "factory_",
        type: "address",
        internalType: "address",
      },
      {
        name: "launchId_",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "policyId_",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policyHash_",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "protectionBlocks_",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "maxBuyBpsPerTransaction_",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "maxBuyBpsPerAddress_",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "BPS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "TEMPLATE_VERSION",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "balance",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "bindProtectedPool",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
      {
        name: "startBlock",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchStartBlock",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxBuyBpsPerAddress",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxBuyBpsPerTransaction",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maximumBuyPerAddress",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maximumBuyPerTransaction",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "metadataURI",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyHash",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protectedPool",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protectionActive",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protectionBlocks",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "purchasedDuringProtection",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "remainingProtectedAllocation",
    inputs: [
      {
        name: "buyer",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      {
        name: "sender",
        type: "address",
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "spender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtectedPoolBound",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "launchStartBlock",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
      {
        name: "policyId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtectedPurchaseRecorded",
    inputs: [
      {
        name: "buyer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "cumulativeAmount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyBound",
    inputs: [],
  },
  {
    type: "error",
    name: "BuyLimitExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientAllowance",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientBalance",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidRecipient",
    inputs: [],
  },
  {
    type: "error",
    name: "LaunchNotStarted",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
] as const;

export const protectedVirtualPoolAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "launchId_",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "templateId_",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "factory_",
        type: "address",
        internalType: "address",
      },
      {
        name: "creator_",
        type: "address",
        internalType: "address",
      },
      {
        name: "baseToken_",
        type: "address",
        internalType: "address",
      },
      {
        name: "config_",
        type: "tuple",
        internalType: "struct DbcTypes.TemplateConfig",
        components: [
          {
            name: "quoteToken",
            type: "address",
            internalType: "address",
          },
          {
            name: "protocolFeeRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "partnerFeeRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "protocolLpRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "quoteDecimals",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "baseDecimals",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "migrationMode",
            type: "uint8",
            internalType: "enum DbcTypes.MigrationMode",
          },
          {
            name: "destinationFeePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "terminalPriceToleranceBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "totalSupplyRaw",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "baseInventoryRaw",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "graduationThresholdRaw",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minimumDestinationShares",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "curve",
            type: "tuple",
            internalType: "struct DbcTypes.CurveConfig",
            components: [
              {
                name: "segmentCount",
                type: "uint8",
                internalType: "uint8",
              },
              {
                name: "segments",
                type: "tuple[16]",
                internalType: "struct DbcTypes.LinearSegment[16]",
                components: [
                  {
                    name: "initialPriceX18",
                    type: "uint128",
                    internalType: "uint128",
                  },
                  {
                    name: "slopeX18",
                    type: "uint128",
                    internalType: "uint128",
                  },
                  {
                    name: "saleCapacityX18",
                    type: "uint128",
                    internalType: "uint128",
                  },
                ],
              },
            ],
          },
          {
            name: "fees",
            type: "tuple",
            internalType: "struct DbcTypes.FeePolicy",
            components: [
              {
                name: "tradeFeeBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "creatorShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "partnerShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "protocolShareBps",
                type: "uint16",
                internalType: "uint16",
              },
            ],
          },
          {
            name: "lp",
            type: "tuple",
            internalType: "struct DbcTypes.LpPolicy",
            components: [
              {
                name: "creatorShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "protocolShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "creatorLockSeconds",
                type: "uint32",
                internalType: "uint32",
              },
            ],
          },
        ],
      },
      {
        name: "feeCollector_",
        type: "address",
        internalType: "address",
      },
      {
        name: "policyHash_",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "protectionStartBlock_",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "protectionBlocks_",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "initialBuyFeeBps_",
        type: "uint16",
        internalType: "uint16",
      },
      {
        name: "baseFeeBps_",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "accounting",
    inputs: [],
    outputs: [
      {
        name: "baseSoldRaw",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "realQuoteReserveRaw",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "creatorFeeLiabilityRaw",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "partnerFeeLiabilityRaw",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "protocolFeeLiabilityRaw",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "baseRoundingDustRaw",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "quoteRoundingDustRaw",
        type: "uint128",
        internalType: "uint128",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activate",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "baseFeeBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "baseToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "buyExactInput",
    inputs: [
      {
        name: "grossQuoteInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumBaseOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.BuyQuote",
        components: [
          {
            name: "grossQuoteConsumedRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "baseOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyExactOutput",
    inputs: [
      {
        name: "baseOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumGrossQuoteInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.BuyQuote",
        components: [
          {
            name: "grossQuoteConsumedRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "baseOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claimFees",
    inputs: [
      {
        name: "allocation",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    outputs: [
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "completeGraduation",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "destinationPool",
        type: "address",
        internalType: "address",
      },
      {
        name: "destinationShares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "config",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct DbcTypes.TemplateConfig",
        components: [
          {
            name: "quoteToken",
            type: "address",
            internalType: "address",
          },
          {
            name: "protocolFeeRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "partnerFeeRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "protocolLpRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "quoteDecimals",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "baseDecimals",
            type: "uint8",
            internalType: "uint8",
          },
          {
            name: "migrationMode",
            type: "uint8",
            internalType: "enum DbcTypes.MigrationMode",
          },
          {
            name: "destinationFeePips",
            type: "uint24",
            internalType: "uint24",
          },
          {
            name: "terminalPriceToleranceBps",
            type: "uint16",
            internalType: "uint16",
          },
          {
            name: "totalSupplyRaw",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "baseInventoryRaw",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "graduationThresholdRaw",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "minimumDestinationShares",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "curve",
            type: "tuple",
            internalType: "struct DbcTypes.CurveConfig",
            components: [
              {
                name: "segmentCount",
                type: "uint8",
                internalType: "uint8",
              },
              {
                name: "segments",
                type: "tuple[16]",
                internalType: "struct DbcTypes.LinearSegment[16]",
                components: [
                  {
                    name: "initialPriceX18",
                    type: "uint128",
                    internalType: "uint128",
                  },
                  {
                    name: "slopeX18",
                    type: "uint128",
                    internalType: "uint128",
                  },
                  {
                    name: "saleCapacityX18",
                    type: "uint128",
                    internalType: "uint128",
                  },
                ],
              },
            ],
          },
          {
            name: "fees",
            type: "tuple",
            internalType: "struct DbcTypes.FeePolicy",
            components: [
              {
                name: "tradeFeeBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "creatorShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "partnerShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "protocolShareBps",
                type: "uint16",
                internalType: "uint16",
              },
            ],
          },
          {
            name: "lp",
            type: "tuple",
            internalType: "struct DbcTypes.LpPolicy",
            components: [
              {
                name: "creatorShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "protocolShareBps",
                type: "uint16",
                internalType: "uint16",
              },
              {
                name: "creatorLockSeconds",
                type: "uint32",
                internalType: "uint32",
              },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "currentBuyFeeBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feeCollector",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "graduation",
    inputs: [],
    outputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "destinationPool",
        type: "address",
        internalType: "address",
      },
      {
        name: "destinationShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "creatorSharesClaimed",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "protocolSharesClaimed",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "graduatedAt",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "graduationManager",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "graduationProgressBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "graduationState",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct DbcTypes.GraduationState",
        components: [
          {
            name: "migrationId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "destinationPool",
            type: "address",
            internalType: "address",
          },
          {
            name: "destinationShares",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "creatorSharesClaimed",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "protocolSharesClaimed",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "graduatedAt",
            type: "uint64",
            internalType: "uint64",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialBuyFeeBps",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint16",
        internalType: "uint16",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lifecycle",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum DbcTypes.Lifecycle",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "policyHash",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protectionBlocks",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "protectionStartBlock",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint64",
        internalType: "uint64",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteBuyExactInput",
    inputs: [
      {
        name: "grossQuoteInRaw",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.BuyQuote",
        components: [
          {
            name: "grossQuoteConsumedRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "baseOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteBuyExactOutput",
    inputs: [
      {
        name: "baseOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.BuyQuote",
        components: [
          {
            name: "grossQuoteConsumedRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "baseOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteSellExactInput",
    inputs: [
      {
        name: "baseInRaw",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.SellQuote",
        components: [
          {
            name: "baseInRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "grossQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteSellExactOutput",
    inputs: [
      {
        name: "netQuoteOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.SellQuote",
        components: [
          {
            name: "baseInRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "grossQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "quoteToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "releaseMigrationAssets",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "baseAmount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "quoteAmount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sellExactInput",
    inputs: [
      {
        name: "baseInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumQuoteOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.SellQuote",
        components: [
          {
            name: "baseInRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "grossQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sellExactOutput",
    inputs: [
      {
        name: "netQuoteOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumBaseInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.SellQuote",
        components: [
          {
            name: "baseInRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "grossQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setGraduationManager",
    inputs: [
      {
        name: "manager",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setPaused",
    inputs: [
      {
        name: "paused",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "templateId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "CurveSwapExecuted",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "isBuy",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "amountInRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amountOutRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "feeRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "finalPriceX18",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "realQuoteReserveRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "baseSoldRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FeeAccrued",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "creatorAmountRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "partnerAmountRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "protocolAmountRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "FeeClaimed",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "allocation",
        type: "uint8",
        indexed: true,
        internalType: "uint8",
      },
      {
        name: "amountRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationPrepared",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "baseAmountRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "quoteAmountRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationReady",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "realQuoteReserveRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "thresholdRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchMetadataPublished",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "name",
        type: "string",
        indexed: false,
        internalType: "string",
      },
      {
        name: "symbol",
        type: "string",
        indexed: false,
        internalType: "string",
      },
      {
        name: "metadataURI",
        type: "string",
        indexed: false,
        internalType: "string",
      },
      {
        name: "creatorTokenRecipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchTemplateCreated",
    inputs: [
      {
        name: "templateId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "familyId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "version",
        type: "uint32",
        indexed: true,
        internalType: "uint32",
      },
      {
        name: "configHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchTemplateStatusUpdated",
    inputs: [
      {
        name: "templateId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LifecycleUpdated",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "previousLifecycle",
        type: "uint8",
        indexed: false,
        internalType: "enum DbcTypes.Lifecycle",
      },
      {
        name: "nextLifecycle",
        type: "uint8",
        indexed: false,
        internalType: "enum DbcTypes.Lifecycle",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LpAllocated",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "allocation",
        type: "uint8",
        indexed: true,
        internalType: "uint8",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "unlockTimestamp",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LpClaimed",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PoolGraduated",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "destinationPool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "destinationShares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "baseUsedRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "quoteUsedRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "templateId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "creator",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "token",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "virtualPool",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "quoteToken",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "baseInventoryRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "graduationThresholdRaw",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyActivated",
    inputs: [],
  },
  {
    type: "error",
    name: "CurveCapacityExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "CurveCapacityExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "CurveCapacityExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "DeadlineExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "DiscontinuousCurve",
    inputs: [],
  },
  {
    type: "error",
    name: "DivisionByZero",
    inputs: [],
  },
  {
    type: "error",
    name: "InsufficientReserve",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConfiguration",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidCurve",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidDecimals",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFee",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFeeSchedule",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidInventory",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidLifecycle",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMathInput",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMathInput",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidRecipient",
    inputs: [],
  },
  {
    type: "error",
    name: "MathOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "MultiplicationOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SlippageExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
] as const;

export const protectedLaunchRouterAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "buyExactInput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "grossQuoteInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumBaseOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.BuyQuote",
        components: [
          {
            name: "grossQuoteConsumedRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "baseOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "buyExactOutput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "baseOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumGrossQuoteInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.BuyQuote",
        components: [
          {
            name: "grossQuoteConsumedRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "baseOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ProtectedLaunchFactory",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "factory_",
        type: "address",
        internalType: "contract ProtectedLaunchFactory",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sellExactInput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "baseInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumQuoteOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.SellQuote",
        components: [
          {
            name: "baseInRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "grossQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sellExactOutput",
    inputs: [
      {
        name: "pool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "quoteOutRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "maximumBaseInRaw",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumPriceX18",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "quote",
        type: "tuple",
        internalType: "struct ProtectedVirtualPool.SellQuote",
        components: [
          {
            name: "baseInRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "grossQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "netQuoteOutRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "feeRaw",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "finalPriceX18",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidFactory",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPool",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "SlippageExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const protectedLpAllocationEscrowAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MANAGER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accountedShares",
    inputs: [
      {
        name: "custodyKey",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "shares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allocations",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "pool",
        type: "address",
        internalType: "address",
      },
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "protocolRecipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "policyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "creatorShares",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "protocolShares",
        type: "uint128",
        internalType: "uint128",
      },
      {
        name: "creatorUnlockAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "isDlmm",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "creatorClaimed",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "protocolClaimed",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "creatorAllocation",
        type: "bool",
        internalType: "bool",
      },
      {
        name: "minimumAmount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "minimumAmount1",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "amount0",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getAllocation",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ProtectedLPAllocationEscrow.Allocation",
        components: [
          {
            name: "pool",
            type: "address",
            internalType: "address",
          },
          {
            name: "creator",
            type: "address",
            internalType: "address",
          },
          {
            name: "protocolRecipient",
            type: "address",
            internalType: "address",
          },
          {
            name: "policyHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "policyId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "creatorShares",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "protocolShares",
            type: "uint128",
            internalType: "uint128",
          },
          {
            name: "creatorUnlockAt",
            type: "uint64",
            internalType: "uint64",
          },
          {
            name: "binId",
            type: "int24",
            internalType: "int24",
          },
          {
            name: "isDlmm",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "creatorClaimed",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "protocolClaimed",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerDammAllocation",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        internalType: "contract DammPool",
      },
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "protocolRecipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "creatorShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "protocolShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "creatorUnlockAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "minimumTotalShares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "registerDlmmAllocation",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        internalType: "contract DlmmPool",
      },
      {
        name: "binId",
        type: "int24",
        internalType: "int24",
      },
      {
        name: "policyId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "policyHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "creator",
        type: "address",
        internalType: "address",
      },
      {
        name: "protocolRecipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "creatorShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "protocolShares",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "creatorUnlockAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "minimumTotalShares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "ProtectedAllocationClaimed",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "recipient",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "creatorAllocation",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "shares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount0",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "amount1",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ProtectedAllocationRegistered",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "pool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "policyHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "policyId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "creator",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "protocolRecipient",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "creatorShares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "protocolShares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "creatorUnlockAt",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
      {
        name: "binId",
        type: "int24",
        indexed: false,
        internalType: "int24",
      },
      {
        name: "isDlmm",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AllocationAlreadyRegistered",
    inputs: [],
  },
  {
    type: "error",
    name: "AllocationUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAllocation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "Locked",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "ReentrantCall",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnauthorizedClaim",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const protectedGraduationManagerAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_MIGRATION_ATTEMPTS",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accountingReconciles",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "adapterAllowed",
    inputs: [
      {
        name: "adapter",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "allowed",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "adapterSnapshots",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "factory",
        type: "address",
        internalType: "address",
      },
      {
        name: "configurationHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "version",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "mode",
        type: "uint8",
        internalType: "enum DbcTypes.MigrationMode",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "executeGraduation",
    inputs: [
      {
        name: "sourcePool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "adapter",
        type: "address",
        internalType: "contract IGraduationAdapter",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "destinationPool",
        type: "address",
        internalType: "address",
      },
      {
        name: "destinationShares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "graduate",
    inputs: [
      {
        name: "sourcePool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
      {
        name: "adapter",
        type: "address",
        internalType: "contract IGraduationAdapter",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "destinationPool",
        type: "address",
        internalType: "address",
      },
      {
        name: "destinationShares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "launchFactory_",
        type: "address",
        internalType: "contract ProtectedLaunchFactory",
      },
      {
        name: "lpEscrow_",
        type: "address",
        internalType: "contract ProtectedLPAllocationEscrow",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "launchFactory",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ProtectedLaunchFactory",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "launchpadBindingResolver",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lpEscrow",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ProtectedLPAllocationEscrow",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "migrationAccounting",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "totalSupply",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "availableBase",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "availableQuote",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "baseMigrated",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "quoteMigrated",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "baseSurplus",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "quoteSurplus",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "creatorFeeLiability",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "partnerFeeLiability",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "protocolFeeLiability",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "baseRoundingDust",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "quoteRoundingDust",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "sourceBaseAfter",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "sourceQuoteAfter",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "migrationAttemptState",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "status",
        type: "uint8",
        internalType: "enum ProtectedGraduationManager.MigrationStatus",
      },
      {
        name: "attempts",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "lastFailureHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "migrationByLaunch",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "migrationCompleted",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "completed",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "migrationContext",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "launchpadId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "configHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "feeSnapshotId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "graduationDestination",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "migrations",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "sourcePool",
        type: "address",
        internalType: "address",
      },
      {
        name: "adapter",
        type: "address",
        internalType: "address",
      },
      {
        name: "status",
        type: "uint8",
        internalType: "enum ProtectedGraduationManager.MigrationStatus",
      },
      {
        name: "attempts",
        type: "uint8",
        internalType: "uint8",
      },
      {
        name: "updatedAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "lastFailureHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "launchpadId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "configHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "feeSnapshotId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "graduationDestination",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "reopenMigration",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "retryGraduation",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "deadline",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "destinationPool",
        type: "address",
        internalType: "address",
      },
      {
        name: "destinationShares",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAdapter",
    inputs: [
      {
        name: "adapter",
        type: "address",
        internalType: "address",
      },
      {
        name: "allowed",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLaunchpadBindingResolver",
    inputs: [
      {
        name: "resolver",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "statusForPool",
    inputs: [
      {
        name: "sourcePool",
        type: "address",
        internalType: "contract ProtectedVirtualPool",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "enum ProtectedGraduationManager.MigrationStatus",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "AdapterStatusUpdated",
    inputs: [
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "allowed",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationAdapterBound",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "adapter",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "factory",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "version",
        type: "uint32",
        indexed: false,
        internalType: "uint32",
      },
      {
        name: "mode",
        type: "uint8",
        indexed: false,
        internalType: "enum DbcTypes.MigrationMode",
      },
      {
        name: "configurationHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationAttemptPending",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "attempt",
        type: "uint8",
        indexed: false,
        internalType: "uint8",
      },
      {
        name: "failureHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationAttemptStarted",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "sourcePool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "adapter",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "attempt",
        type: "uint8",
        indexed: false,
        internalType: "uint8",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationCompleted",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "destinationPool",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "baseMigrated",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "quoteMigrated",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "destinationShares",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationContextBound",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchpadId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "configHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "feeSnapshotId",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "graduationDestination",
        type: "uint8",
        indexed: false,
        internalType: "uint8",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationNeedsReview",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "attempts",
        type: "uint8",
        indexed: false,
        internalType: "uint8",
      },
      {
        name: "failureHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "GraduationReviewReopened",
    inputs: [
      {
        name: "migrationId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "LaunchpadBindingResolverUpdated",
    inputs: [
      {
        name: "previousResolver",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "resolver",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccountingMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "AdapterUnavailable",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "AlreadyMigrated",
    inputs: [],
  },
  {
    type: "error",
    name: "CurveCapacityExceeded",
    inputs: [],
  },
  {
    type: "error",
    name: "DiscontinuousCurve",
    inputs: [],
  },
  {
    type: "error",
    name: "DivisionByZero",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidCurve",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidDecimals",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidLaunch",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMathInput",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMigrationAmounts",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMigrationMode",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidMigrationState",
    inputs: [],
  },
  {
    type: "error",
    name: "LaunchpadBindingMismatch",
    inputs: [],
  },
  {
    type: "error",
    name: "MathOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "MultiplicationOverflow",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "TransferFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnauthorizedSelfCall",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UnsupportedTokenBehavior",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const protectedLaunchIdentityRegistryAbi = [
  {
    type: "constructor",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "FACTORY_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "IDENTITY_CONSUMER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "UPGRADER_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "firstLaunchByName",
    inputs: [
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "firstLaunchBySymbol",
    inputs: [
      {
        name: "commitment",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "identity",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ProtectedLaunchIdentityRegistry.Identity",
        components: [
          {
            name: "canonicalHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "nameCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "symbolCommitment",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "metadataHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "socialHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "tokenRuntimeCodeHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "factory",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "pool",
            type: "address",
            internalType: "address",
          },
          {
            name: "launchpadId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "tokenTemplateVersion",
            type: "uint32",
            internalType: "uint32",
          },
          {
            name: "duplicateName",
            type: "bool",
            internalType: "bool",
          },
          {
            name: "duplicateSymbol",
            type: "bool",
            internalType: "bool",
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initialize",
    inputs: [
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "upgrader",
        type: "address",
        internalType: "address",
      },
      {
        name: "consumer",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "normalizedCommitment",
    inputs: [
      {
        name: "value",
        type: "string",
        internalType: "string",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "registerIdentity",
    inputs: [
      {
        name: "input",
        type: "tuple",
        internalType: "struct ProtectedLaunchIdentityRegistry.IdentityInput",
        components: [
          {
            name: "launchId",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "factory",
            type: "address",
            internalType: "address",
          },
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "pool",
            type: "address",
            internalType: "address",
          },
          {
            name: "launchpadId",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "name",
            type: "string",
            internalType: "string",
          },
          {
            name: "symbol",
            type: "string",
            internalType: "string",
          },
          {
            name: "metadataHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "socialHash",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "tokenTemplateVersion",
            type: "uint32",
            internalType: "uint32",
          },
        ],
      },
    ],
    outputs: [
      {
        name: "canonicalHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "ProtectedLaunchIdentityRegistered",
    inputs: [
      {
        name: "launchId",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "canonicalHash",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "token",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "pool",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "nameCommitment",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "symbolCommitment",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "metadataHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "socialHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "tokenRuntimeCodeHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "launchpadId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "tokenTemplateVersion",
        type: "uint32",
        indexed: false,
        internalType: "uint32",
      },
      {
        name: "duplicateName",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
      {
        name: "duplicateSymbol",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleUpdated",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "enabled",
        type: "bool",
        indexed: false,
        internalType: "bool",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "IdentityAlreadyRegistered",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidAccount",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidIdentity",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [],
  },
  {
    type: "error",
    name: "NotInitializing",
    inputs: [],
  },
  {
    type: "error",
    name: "OnlyProxy",
    inputs: [],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedProxiableUUID",
    inputs: [],
  },
  {
    type: "error",
    name: "UpgradeCallFailed",
    inputs: [
      {
        name: "reason",
        type: "bytes",
        internalType: "bytes",
      },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      {
        name: "spender",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferFrom",
    inputs: [
      {
        name: "sender",
        type: "address",
        internalType: "address",
      },
      {
        name: "recipient",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "nonpayable",
  },
] as const;
