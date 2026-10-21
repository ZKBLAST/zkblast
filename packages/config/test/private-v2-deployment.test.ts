import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  verifyPrivateV2Deployment,
  type PrivateV2RpcRequest,
} from "../src/private-v2-deployment.js";
import {
  privateV2ConfigIssue,
  type PrivateVaultV2Config,
} from "../src/private-prover-v2.js";

// Injected deterministic hash for gate unit tests only, not production keccak.
type Hex = `0x${string}`;
const hash = (data: Hex | Uint8Array): Hex =>
  `0x${createHash("sha256")
    .update(typeof data === "string" ? Buffer.from(data.slice(2), "hex") : data)
    .digest("hex")}`;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const word = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const config: PrivateVaultV2Config = {
  vault: address(1),
  fieldHasher: address(2),
  treeVersion: 2,
  deploymentBlock: 100,
  proverRelease: {
    manifestPath: "/zk/mainnet/v2/release.json",
    manifestSha256: "a".repeat(64),
  },
  verifiedDeployment: {
    chainId: 4663,
    transactionHash: word(99),
    verifiedBlock: 105,
    implementation: address(3),
    proxyRuntimeHash: hash("0x6001"),
    implementationRuntimeHash: hash("0x6003"),
    fieldHasherRuntimeHash: hash("0x6002"),
    actionAdapterRuntimeHash: hash("0x6004"),
    fundAdapterRuntimeHash: hash("0x6005"),
    actionGroth16RuntimeHash: hash("0x6006"),
    fundGroth16RuntimeHash: hash("0x6007"),
  },
};
function reader(change?: string): PrivateV2RpcRequest {
  return async ({ method, params = [] }) => {
    if (method === "eth_chainId")
      return change === "chain" ? "0xb626" : "0x1237";
    if (method === "eth_blockNumber") return "0x70";
    if (method === "eth_getTransactionReceipt")
      return change === "receipt"
        ? null
        : {
            status: "0x1",
            contractAddress: address(1),
            blockNumber: "0x64",
            blockHash: word(101),
          };
    if (method === "eth_getBlockByNumber") return { hash: word(101) };
    if (method === "eth_getStorageAt") return word(3);
    if (method === "eth_getCode")
      return change === "code"
        ? "0x"
        : `0x60${BigInt(String(params[0])).toString(16).padStart(2, "0")}`;
    if (method === "eth_call") {
      const tx = params[0] as { to: string; data: string };
      const selector = (s: string) =>
        hash(new TextEncoder().encode(s)).slice(0, 10);
      if (tx.data === selector("treeVersion()")) return word(2);
      if (tx.data === selector("fieldHasher()")) return word(2);
      if (tx.data === selector("actionVerifier()")) return word(4);
      if (tx.data === selector("fundVerifier()")) return word(5);
      if (tx.data === selector("verifier()"))
        return word(tx.to === address(4) ? 6 : 7);
    }
    throw new Error("UNEXPECTED_RPC");
  };
}
test("mainnet startup verifies real receipt, proxy slot, pinned runtimes and verifier epoch via read-only RPC", async () => {
  await verifyPrivateV2Deployment(
    { environment: "mainnet", chainId: 4663, config },
    reader(),
    hash,
  );
  for (const change of ["chain", "receipt", "code"])
    await assert.rejects(
      verifyPrivateV2Deployment(
        { environment: "mainnet", chainId: 4663, config },
        reader(change),
        hash,
      ),
      /DEPLOYMENT_MISMATCH/u,
    );
});
test("predicted or cross-network configuration cannot activate mainnet v2", async () => {
  const { verifiedDeployment: _evidence, ...candidate } = config;
  assert.equal(
    privateV2ConfigIssue("mainnet", 4663, candidate),
    "V2_MAINNET_VERIFIED_DEPLOYMENT_REQUIRED",
  );
  assert.equal(
    privateV2ConfigIssue("mainnet", 4663, {
      ...config,
      proverRelease: {
        ...config.proverRelease!,
        manifestPath: "/zk/testnet/v2/release.json",
      },
    }),
    "V2_RELEASE_NETWORK_MISMATCH",
  );
  await assert.rejects(
    verifyPrivateV2Deployment(
      { environment: "mainnet", chainId: 4663, config: candidate },
      async () => {
        throw new Error("MUST_NOT_CALL_RPC");
      },
      hash,
    ),
    /VERIFIED_DEPLOYMENT/u,
  );
});

test("transport failures never leak RPC credentials through startup exceptions", async () => {
  await assert.rejects(
    verifyPrivateV2Deployment(
      { environment: "mainnet", chainId: 4663, config },
      async () => {
        throw new Error("request failed https://rpc.invalid/private-api-key");
      },
      hash,
    ),
    (error) =>
      error instanceof Error &&
      error.message === "V2_DEPLOYMENT_VERIFICATION_UNAVAILABLE",
  );
});
