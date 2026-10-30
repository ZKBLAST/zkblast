export {
  privateVaultV2Abi,
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
export { liquidityVaultUsdGAbi, perpEngineAbi, perpsEventsAbi, shieldedPerpAdapterAbi } from "./perps.js";

import {
  privateVaultV2Abi,
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
import { perpsEventsAbi } from "./perps.js";

export const protocolAbis = {
  PrivateVaultV2: privateVaultV2Abi,
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
  Perps: perpsEventsAbi,
} as const;
