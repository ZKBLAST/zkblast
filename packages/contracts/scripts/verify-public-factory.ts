import {
  getAddress,
  keccak256,
  toHex,
  zeroHash,
  type Abi,
  type Address,
  type PublicClient,
} from "viem";
import { accessAbi, check } from "./permissionless-upgrade-support.js";

/** Public entry-point acceptance uses eth_call only; no pool is persisted or funded. */
export async function verifyPublicFactory(
  client: PublicClient,
  input: {
    proxy: Address;
    registry: Address;
    governor: Address;
    timelock: Address;
    oldUpgrader: Address;
    migrated: boolean;
    factoryAbi: Abi;
  },
) {
  const stranger = getAddress("0x00000000000000000000000000000000000a11ce");
  const role = keccak256(toHex("ZKBLAST_UPGRADER_ROLE"));
  const [admin, upgrader, strangerAdmin, strangerUpgrader] = await Promise.all([
    client.readContract({
      address: input.proxy,
      abi: accessAbi,
      functionName: "hasRole",
      args: [zeroHash, input.governor],
    }),
    client.readContract({
      address: input.proxy,
      abi: accessAbi,
      functionName: "hasRole",
      args: [role, input.timelock],
    }),
    client.readContract({
      address: input.proxy,
      abi: accessAbi,
      functionName: "hasRole",
      args: [zeroHash, stranger],
    }),
    client.readContract({
      address: input.proxy,
      abi: accessAbi,
      functionName: "hasRole",
      args: [role, stranger],
    }),
  ]);
  check(
    admin && upgrader && !strangerAdmin && !strangerUpgrader,
    "POST_UPGRADE_ROLES_INVALID",
  );
  if (input.migrated)
    check(
      !(await client.readContract({
        address: input.proxy,
        abi: accessAbi,
        functionName: "hasRole",
        args: [role, input.oldUpgrader],
      })),
      "DIRECT_UPGRADER_NOT_REVOKED",
    );
  const tokenA = getAddress(process.env.EXECUTION_USDG_ADDRESS ?? "");
  const tokenB = getAddress(process.env.EXECUTION_WETH_ADDRESS ?? "");
  for (const address of [tokenA, tokenB]) {
    const code = await client.getBytecode({ address });
    check(code && code !== "0x", "ACCEPTANCE_TOKEN_HAS_NO_CODE");
  }
  const before = await client.readContract({
    address: input.registry,
    abi: accessAbi,
    functionName: "poolCount",
  });
  const previews = [];
  for (const model of ["damm", "dlmm"] as const) {
    const functionName = model === "damm" ? "createPool" : "createDlmmPool";
    const args =
      model === "damm"
        ? [tokenA, tokenB, 0, 7391, 0]
        : [tokenA, tokenB, 7391, 37, -100];
    const result = await client.simulateContract({
      account: stranger,
      address: input.proxy,
      abi: input.factoryAbi,
      functionName,
      args,
    });
    previews.push({
      model,
      passed: true,
      callOnly: true,
      predictedPool: getAddress(result.result as Address),
    });
  }
  const after = await client.readContract({
    address: input.registry,
    abi: accessAbi,
    functionName: "poolCount",
  });
  check(after === before, "READ_ONLY_ACCEPTANCE_POOL_COUNT_CHANGED");
  return {
    nonAdminWallet: stranger,
    adminAndUpgradeRolesPreserved: true,
    directWalletUpgraderRevoked: input.migrated ? true : null,
    publicCreationAcceptance: previews,
    poolCountBefore: before.toString(),
    poolCountAfter: after.toString(),
    livePoolCreationTransactions: 0,
  };
}
