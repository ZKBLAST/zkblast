import { getChainDescriptor } from "@zkblast/config";
import type { ApiChainContext } from "./app.js";

const CHAIN_ID = 99_801;

/**
 * Publishes the Elysium network boundary before contracts are deployed.
 * Execution dependencies are deliberately absent, so every feature route
 * fails closed until a receipt-backed manifest is installed.
 */
export function createElysiumTestnetContext(input: Readonly<{
  webOrigin: string;
}>): ApiChainContext {
  const descriptor = getChainDescriptor(CHAIN_ID);
  if (descriptor.family !== "elysium" || descriptor.environment !== "testnet")
    throw new Error("ELYSIUM_TESTNET_DESCRIPTOR_MISMATCH");
  if (Object.values(descriptor.capabilities).some(Boolean))
    throw new Error("ELYSIUM_TESTNET_CAPABILITIES_MUST_REMAIN_DISABLED");

  return {
    config: {
      environment: descriptor.environment,
      chainId: descriptor.chainId,
      chainName: descriptor.name,
      explorerUrl: descriptor.explorerUrl ?? "",
      webOrigin: input.webOrigin,
    },
    dependencies: {},
  };
}
