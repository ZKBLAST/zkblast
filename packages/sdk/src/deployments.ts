import {
  parseDeploymentManifest,
  type DeploymentManifest,
} from "@zkblast/config";
import { getAddress, type Address } from "viem";

export type ProtocolAddresses = Readonly<{
  poolRegistry: Address;
  poolFactory: Address;
  swapRouter: Address;
  positionManager: Address;
  poolQuoter: Address;
}>;

export function resolveProtocolAddresses(
  input: unknown,
  runtime: Readonly<{
    environment: DeploymentManifest["environment"];
    chainId: number;
  }>,
): ProtocolAddresses {
  const { integration } = parseDeploymentManifest(input, runtime);
  return {
    poolRegistry: getAddress(integration.poolRegistry),
    poolFactory: getAddress(integration.poolFactory),
    swapRouter: getAddress(integration.swapRouter),
    positionManager: getAddress(integration.positionManager),
    poolQuoter: getAddress(integration.poolQuoter),
  };
}
