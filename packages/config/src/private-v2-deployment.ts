import {
  privateV2ConfigIssue,
  type PrivateVaultV2Config,
} from "./private-prover-v2.js";

export type PrivateV2RpcRequest = (input: {
  method: string;
  params?: unknown[];
}) => Promise<unknown>;
type Hex = `0x${string}`;
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Read-only startup gate; candidate/predicted addresses never satisfy this check. */
async function verifyPrivateV2DeploymentState(
  input: {
    environment: "mainnet" | "testnet";
    chainId: number;
    config?: PrivateVaultV2Config | undefined;
    legacyVault?: string | undefined;
  },
  rpc: PrivateV2RpcRequest,
  keccak: (data: Hex | Uint8Array) => Hex,
): Promise<void> {
  const config = input.config;
  if (!config) return;
  const issue = privateV2ConfigIssue(
    input.environment,
    input.chainId,
    config,
    input.legacyVault,
  );
  if (issue) throw new Error(issue);
  if (input.environment !== "mainnet") return;
  const evidence = config.verifiedDeployment!;
  const check = (valid: unknown) => {
    if (!valid) throw new Error("V2_MAINNET_DEPLOYMENT_MISMATCH");
  };
  check(
    BigInt(String(await rpc({ method: "eth_chainId" }))) ===
      BigInt(input.chainId),
  );
  const head = String(await rpc({ method: "eth_blockNumber" }));
  check(BigInt(head) >= BigInt(evidence.verifiedBlock));
  const code = async (address: string, expected: string) => {
    const bytes = String(
      await rpc({ method: "eth_getCode", params: [address, head] }),
    );
    check(
      /^0x[\da-f]+$/iu.test(bytes) &&
        bytes !== "0x" &&
        keccak(bytes as Hex).toLowerCase() === expected.toLowerCase(),
    );
  };
  const call = async (address: string, signature: string) => {
    const data = keccak(new TextEncoder().encode(signature)).slice(0, 10);
    const result = String(
      await rpc({ method: "eth_call", params: [{ to: address, data }, head] }),
    );
    check(/^0x[\da-f]{64}$/iu.test(result));
    return result;
  };
  const address = (word: string) => `0x${word.slice(-40)}`;
  const receipt = (await rpc({
    method: "eth_getTransactionReceipt",
    params: [evidence.transactionHash],
  })) as {
    status?: string;
    contractAddress?: string;
    blockNumber?: string;
    blockHash?: string;
  } | null;
  check(
    receipt?.status === "0x1" &&
      receipt.contractAddress?.toLowerCase() === config.vault.toLowerCase() &&
      BigInt(receipt.blockNumber ?? "0") === BigInt(config.deploymentBlock) &&
      config.deploymentBlock <= evidence.verifiedBlock,
  );
  const block = (await rpc({
    method: "eth_getBlockByNumber",
    params: [receipt!.blockNumber, false],
  })) as { hash?: string };
  check(
    block?.hash &&
      block.hash.toLowerCase() === receipt!.blockHash?.toLowerCase(),
  );
  await code(config.vault, evidence.proxyRuntimeHash);
  const implementation = address(
    String(
      await rpc({
        method: "eth_getStorageAt",
        params: [config.vault, slot, head],
      }),
    ),
  );
  check(implementation.toLowerCase() === evidence.implementation.toLowerCase());
  await code(implementation, evidence.implementationRuntimeHash);
  check(
    BigInt(await call(config.vault, "treeVersion()")) ===
      BigInt(config.treeVersion),
  );
  check(
    address(await call(config.vault, "fieldHasher()")).toLowerCase() ===
      config.fieldHasher.toLowerCase(),
  );
  await code(config.fieldHasher, evidence.fieldHasherRuntimeHash);
  for (const [getter, hash, adapterHash] of [
    [
      "actionVerifier()",
      evidence.actionGroth16RuntimeHash,
      evidence.actionAdapterRuntimeHash,
    ],
    [
      "fundVerifier()",
      evidence.fundGroth16RuntimeHash,
      evidence.fundAdapterRuntimeHash,
    ],
  ]) {
    const adapter = address(await call(config.vault, getter!));
    await code(adapter, adapterHash!);
    const verifier = address(await call(adapter, "verifier()"));
    await code(verifier, hash!);
  }
  for (const asset of config.assets ?? []) {
    const selector = keccak(new TextEncoder().encode("assetEnabled(address)")).slice(0, 10);
    const result = String(
      await rpc({
        method: "eth_call",
        params: [
          {
            to: config.vault,
            data: `${selector}${asset.address.slice(2).padStart(64, "0")}`,
          },
          head,
        ],
      }),
    );
    check(/^0x[\da-f]{64}$/iu.test(result));
    check((BigInt(result) === 1n) === asset.enabled);
  }
}

/** Never let transport errors expose a credential-bearing RPC URL at startup. */
export async function verifyPrivateV2Deployment(
  ...args: Parameters<typeof verifyPrivateV2DeploymentState>
): Promise<void> {
  try {
    await verifyPrivateV2DeploymentState(...args);
  } catch (error) {
    if (error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message))
      throw error;
    throw new Error("V2_DEPLOYMENT_VERIFICATION_UNAVAILABLE");
  }
}
