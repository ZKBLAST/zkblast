export {
  dammPoolAbi,
  dlmmPoolAbi,
  erc20Abi,
  poolFactoryAbi,
  poolQuoterAbi,
  poolRegistryAbi,
  positionManagerAbi,
  swapRouterAbi,
  zkBlastVaultAbi,
  shieldedStateRegistryAbi,
  shieldedLPManagerAbi,
} from "./generated.js";

import {
  dammPoolAbi,
  dlmmPoolAbi,
  erc20Abi,
  poolFactoryAbi,
  poolQuoterAbi,
  poolRegistryAbi,
  positionManagerAbi,
  swapRouterAbi,
  zkBlastVaultAbi,
  shieldedStateRegistryAbi,
  shieldedLPManagerAbi,
} from "./generated.js";

export const protocolAbis = {
  PoolRegistry: poolRegistryAbi,
  PoolFactory: poolFactoryAbi,
  DammPool: dammPoolAbi,
  DlmmPool: dlmmPoolAbi,
  PoolQuoter: poolQuoterAbi,
  SwapRouter: swapRouterAbi,
  PositionManager: positionManagerAbi,
  ZKBlastVault: zkBlastVaultAbi,
  ShieldedStateRegistry: shieldedStateRegistryAbi,
  ShieldedLPManager: shieldedLPManagerAbi,
  ERC20: erc20Abi,
} as const;
