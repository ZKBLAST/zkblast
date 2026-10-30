import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  TransactionReceiptNotFoundError,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { PerpsRelayerWorker, type PerpsRelayChain } from "./perps-relayer.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PERPS_RELAYER_${name}_REQUIRED`);
  return value;
};

export async function startPerpsRelayerFromEnv(): Promise<() => Promise<void>> {
  const environment = required("APP_ENV");
  if (environment !== "testnet" && environment !== "mainnet") throw new Error("PERPS_RELAYER_ENV_INVALID");
  const chainId = Number(required("CHAIN_ID"));
  const expectedChainId = environment === "mainnet" ? 4663 : 46630;
  if (chainId !== expectedChainId) throw new Error("PERPS_RELAYER_CHAIN_INVALID");
  const configuredManifestPath = required("DEPLOYMENT_MANIFEST_PATH");
  const manifestPath = path.isAbsolute(configuredManifestPath)
    ? configuredManifestPath
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", configuredManifestPath);
  const manifest = await loadDeploymentManifestFile(manifestPath, { environment, chainId });
  if (!manifest.perps) throw new Error("PERPS_RELAYER_DEPLOYMENT_MISSING");
  const privateKey = required("PERPS_RELAYER_PRIVATE_KEY") as Hex;
  if (!/^0x[0-9a-f]{64}$/iu.test(privateKey)) throw new Error("PERPS_RELAYER_KEY_INVALID");
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== manifest.perps.relayer.address.toLowerCase()) {
    throw new Error("PERPS_RELAYER_ACCOUNT_MISMATCH");
  }
  const rpcUrl = required("RPC_URL");
  const chain = defineChain({
    id: chainId,
    name: required("CHAIN_NAME"),
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 1 }) });
  if (await publicClient.getChainId() !== chainId) throw new Error("PERPS_RELAYER_RPC_MISMATCH");
  const relayChain: PerpsRelayChain = {
    simulate: async ({ from, to, data }) => { await publicClient.call({ account: from, to, data }); },
    estimateGas: async ({ from, to, data }) => publicClient.estimateGas({ account: from, to, data }),
    submit: async ({ to, data, gas }) => walletClient.sendTransaction({ account, to, data, gas, chain }),
    receipt: async (hash) => {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return receipt.status === "success" ? "success" : "reverted";
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return "pending";
        throw error;
      }
    },
  };
  const maximumGas = BigInt(required("PERPS_RELAYER_MAX_GAS"));
  const pollMs = Number(required("PERPS_RELAYER_POLL_MS"));
  if (!Number.isInteger(pollMs) || pollMs < 1_000 || pollMs > 60_000) {
    throw new Error("PERPS_RELAYER_POLL_INVALID");
  }
  const worker = new PerpsRelayerWorker({
    databaseUrl: required("SUPABASE_DIRECT_DATABASE_URL"),
    schema: required("SUPABASE_SCHEMA"),
    account: getAddress(account.address),
    adapter: getAddress(manifest.perps.shieldedAdapter),
    chain: relayChain,
    maximumGas,
  });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    if (stopped) return;
    try {
      await worker.tick();
    } catch {
      // The loop remains alive; structured health/alert integration is added at deployment time.
    } finally {
      if (!stopped) timer = setTimeout(() => void loop(), pollMs);
    }
  };
  void loop();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await worker.close();
  };
}
