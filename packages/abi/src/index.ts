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
  launchProtectionPolicyRegistryAbi,
  protectedLaunchFactoryAbi,
  protectedLaunchTokenAbi,
  protectedVirtualPoolAbi,
  protectedLaunchRouterAbi,
  protectedLpAllocationEscrowAbi,
  protectedGraduationManagerAbi,
  protectedLaunchIdentityRegistryAbi,
} from "./generated.js";
export {
  liquidityVaultUsdGAbi,
  perpEngineAbi,
  perpsEventsAbi,
  shieldedPerpAdapterAbi,
} from "./perps.js";
export {
  dbcEventsAbi,
  graduationManagerAbi,
  launchConfigRegistryAbi,
  launchFactoryAbi,
  lpAllocationEscrowAbi,
  virtualPoolAbi,
} from "./dbc.js";
export {
  launchpadConfigManagerAbi,
  launchpadFactoryAbi,
  launchpadFeeCollectorAbi,
  launchpadFeeControllerAbi,
  launchpadEventsAbi,
  launchpadFeePolicyEventsAbi,
  launchpadProofClaimAdapterAbi,
  launchpadRegistryAbi,
  launchpadRevenueSplitterAbi,
  launchpadTokenFactoryAbi,
} from "./launchpad.js";
export {
  assistanceFeeCollectorAbi,
  assistanceFundExecutorAbi,
  burnModuleAbi,
  buybackRouteRegistryAbi,
  treasuryControllerAbi,
} from "./assistance-fund.js";
export {
  stockQuoteAssetRegistryAbi,
  stockQuoteDestinationRegistryAbi,
  stockQuoteOracleGuardAbi,
} from "./stock-quotes.js";

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
  launchProtectionPolicyRegistryAbi,
  protectedLaunchFactoryAbi,
  protectedLaunchTokenAbi,
  protectedVirtualPoolAbi,
  protectedLpAllocationEscrowAbi,
  protectedGraduationManagerAbi,
  protectedLaunchIdentityRegistryAbi,
} from "./generated.js";
import { perpsEventsAbi } from "./perps.js";
import { dbcEventsAbi } from "./dbc.js";
import { launchpadEventsAbi, launchpadFeePolicyEventsAbi, launchpadTokenFactoryAbi } from "./launchpad.js";
import {
  assistanceFeeCollectorAbi,
  assistanceFundExecutorAbi,
  burnModuleAbi,
  buybackRouteRegistryAbi,
  treasuryControllerAbi,
} from "./assistance-fund.js";
import {
  stockQuoteAssetRegistryAbi,
  stockQuoteDestinationRegistryAbi,
  stockQuoteOracleGuardAbi,
} from "./stock-quotes.js";

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
  DBC: dbcEventsAbi,
  Launchpad: [...launchpadTokenFactoryAbi, ...launchpadEventsAbi, ...launchpadFeePolicyEventsAbi],
  ProtectedPolicy: launchProtectionPolicyRegistryAbi,
  ProtectedFactory: protectedLaunchFactoryAbi,
  ProtectedToken: protectedLaunchTokenAbi,
  ProtectedPool: protectedVirtualPoolAbi,
  ProtectedEscrow: protectedLpAllocationEscrowAbi,
  ProtectedGraduation: protectedGraduationManagerAbi,
  ProtectedIdentity: protectedLaunchIdentityRegistryAbi,
  AssistanceFund: [
    ...assistanceFeeCollectorAbi,
    ...assistanceFundExecutorAbi,
    ...burnModuleAbi,
    ...buybackRouteRegistryAbi,
    ...treasuryControllerAbi,
  ],
  StockQuoteAssetRegistry: stockQuoteAssetRegistryAbi,
  StockQuoteDestinationRegistry: stockQuoteDestinationRegistryAbi,
  StockQuoteOracleGuard: stockQuoteOracleGuardAbi,
} as const;
