import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assistanceFeeCollectorAbi,
  assistanceFundExecutorAbi,
  buybackRouteRegistryAbi,
  poolQuoterAbi,
} from "@zkblast/abi";
import { getChainDescriptor } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { previewAssistanceExecution } from "@zkblast/sdk";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AssistanceFundKeeper,
  type AssistanceExecutionCandidate,
  type AssistanceKeeperPort,
} from "./assistance-fund-keeper.js";
import { createKeeperTransport, keeperRpcUrls } from "./rpc-transport.js";

const revenueAdapterAbi = [
  { type: "function", name: "collect", stateMutability: "nonpayable", inputs: [], outputs: [
    { name: "amount0", type: "uint256" }, { name: "amount1", type: "uint256" },
  ] },
] as const;

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name.startsWith("ASSISTANCE_FUND_") ? name : `ASSISTANCE_FUND_${name}`}_REQUIRED`);
  return value;
};

const assistanceRequired = (name: string) =>
  required(`ASSISTANCE_FUND_${name}`);

const hexList = (name: string, bytes: number): Hex[] => {
  const values = assistanceRequired(name).split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0 || values.some((value) => !new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "iu").test(value))) {
    throw new Error(`ASSISTANCE_FUND_${name}_INVALID`);
  }
  return [...new Set(values.map((value) => value.toLowerCase()))] as Hex[];
};

type PreparedExecution = Readonly<{ to: Address; data: Hex; gas: bigint }>;

export async function startAssistanceFundKeeperFromEnv(): Promise<() => Promise<void>> {
  const environment = required("APP_ENV");
  const chainId = Number(required("CHAIN_ID"));
  if (environment !== "mainnet" || chainId !== 4663) throw new Error("ASSISTANCE_FUND_NETWORK_INVALID");
  const configuredManifestPath = required("DEPLOYMENT_MANIFEST_PATH");
  const manifestPath = path.isAbsolute(configuredManifestPath)
    ? configuredManifestPath
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..", configuredManifestPath);
  const manifest = await loadDeploymentManifestFile(manifestPath, { environment, chainId });
  if (!manifest.assistanceFund) throw new Error("ASSISTANCE_FUND_DEPLOYMENT_MISSING");

  const privateKey = (
    process.env.ASSISTANCE_FUND_KEEPER_PRIVATE_KEY?.trim() ||
    process.env.PERPS_RELAYER_PRIVATE_KEY?.trim()
  ) as Hex | undefined;
  if (!privateKey) throw new Error("ASSISTANCE_FUND_KEEPER_PRIVATE_KEY_REQUIRED");
  if (!/^0x[0-9a-f]{64}$/iu.test(privateKey)) throw new Error("ASSISTANCE_FUND_KEEPER_KEY_INVALID");
  const account = privateKeyToAccount(privateKey);
  const routeIds = hexList("ROUTE_IDS", 32);
  const revenueAdapters = hexList("REVENUE_ADAPTERS", 20).map((value) => getAddress(value));
  const maximumGas = BigInt(assistanceRequired("KEEPER_MAX_GAS"));
  const configuredMaximum = process.env.ASSISTANCE_FUND_KEEPER_MAX_AMOUNT_RAW?.trim();
  const operatorMaximum = configuredMaximum ? BigInt(configuredMaximum) : undefined;
  const pollMs = Number(assistanceRequired("KEEPER_POLL_MS"));
  if (!Number.isInteger(pollMs) || pollMs < 15_000 || pollMs > 3_600_000) throw new Error("ASSISTANCE_FUND_KEEPER_POLL_INVALID");

  const rpcUrls = keeperRpcUrls(required("RPC_URL"), process.env.RPC_FALLBACK_URLS, getChainDescriptor(chainId).publicRpcUrls);
  const chain = defineChain({
    id: chainId,
    name: required("CHAIN_NAME"),
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: rpcUrls } },
  });
  const transport = createKeeperTransport(rpcUrls);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });
  if (await publicClient.getChainId() !== chainId) throw new Error("ASSISTANCE_FUND_RPC_MISMATCH");

  const collector = getAddress(manifest.assistanceFund.collector);
  const routeRegistry = getAddress(manifest.assistanceFund.routeRegistry);
  const executor = getAddress(manifest.assistanceFund.executor);
  const quoter = getAddress(manifest.integration.poolQuoter);

  const collectRevenue = async () => {
    for (const adapter of revenueAdapters) {
      try {
        const simulation = await publicClient.simulateContract({ address: adapter, abi: revenueAdapterAbi, functionName: "collect", account });
        const gas = await publicClient.estimateContractGas({ address: adapter, abi: revenueAdapterAbi, functionName: "collect", account });
        if (gas > maximumGas) throw new Error("ASSISTANCE_FUND_GAS_LIMIT_EXCEEDED");
        const hash = await walletClient.writeContract({ ...simulation.request, gas });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
        if (receipt.status !== "success") throw new Error("ASSISTANCE_FUND_REVENUE_COLLECTION_REVERTED");
        console.log(JSON.stringify({ service: "keeper", component: "assistance-fund", action: "collect", adapter, hash }));
      } catch {
        // Empty fee balances intentionally revert; no transaction or gas is spent.
      }
    }
  };

  const port: AssistanceKeeperPort = {
    async discover() {
      const candidates: AssistanceExecutionCandidate[] = [];
      const currentDay = BigInt(Math.floor(Date.now() / 86_400_000));
      for (const routeId of routeIds) {
        const route = await publicClient.readContract({ address: routeRegistry, abi: buybackRouteRegistryAbi, functionName: "getRoute", args: [routeId] });
        if (!route.enabled) continue;
        const reconciliation = await publicClient.readContract({ address: collector, abi: assistanceFeeCollectorAbi, functionName: "reconciliation", args: [route.inputAsset] });
        if (!reconciliation[5]) continue;
        const [day, , spent] = await publicClient.readContract({ address: routeRegistry, abi: buybackRouteRegistryAbi, functionName: "spendWindow", args: [routeId] });
        const spentToday = BigInt(day) === currentDay ? spent : 0n;
        const dailyRemaining = route.limits.maximumDailySpend > spentToday ? route.limits.maximumDailySpend - spentToday : 0n;
        let amountIn = [reconciliation[1], route.limits.maximumAmount, dailyRemaining].reduce((minimum, value) => value < minimum ? value : minimum);
        if (operatorMaximum !== undefined && amountIn > operatorMaximum) amountIn = operatorMaximum;
        if (amountIn < route.limits.minimumAmount) continue;
        candidates.push({ idempotencyKey: `${chainId}:${routeId}:${day}:${spent}:${amountIn}`, routeId, amountIn });
      }
      return candidates;
    },
    async simulate(candidate) {
      try {
        const route = await publicClient.readContract({ address: routeRegistry, abi: buybackRouteRegistryAbi, functionName: "getRoute", args: [candidate.routeId] });
        const quoted = route.model === 0
          ? (await publicClient.readContract({ address: quoter, abi: poolQuoterAbi, functionName: "quoteDammExactInput", args: [route.pool, route.inputAsset, candidate.amountIn] }))[0]
          : (await publicClient.readContract({ address: quoter, abi: poolQuoterAbi, functionName: "quoteDlmmExactInput", args: [route.pool, route.token0ToToken1, candidate.amountIn, route.maximumBinCrossings] }))[0];
        const preview = previewAssistanceExecution({
          amountIn: candidate.amountIn,
          quotedAmountOut: quoted,
          minimumAmount: route.limits.minimumAmount,
          maximumAmount: route.limits.maximumAmount,
          maximumSlippageBps: route.limits.maximumSlippageBps,
          enabled: route.enabled,
        });
        if (!preview.executable) return { executable: false, retryable: false, reason: preview.reason };
        const deadline = BigInt(Math.floor(Date.now() / 1_000) + Math.max(30, Math.floor(route.limits.swapDeadlineSeconds / 2)));
        const data = encodeFunctionData({ abi: assistanceFundExecutorAbi, functionName: "executeBuyback", args: [candidate.routeId, candidate.amountIn, preview.minimumAmountOut, deadline] });
        await publicClient.call({ account, to: executor, data });
        const gas = await publicClient.estimateGas({ account, to: executor, data });
        if (gas > maximumGas) return { executable: false, retryable: false, reason: "GAS_LIMIT_EXCEEDED" };
        return { executable: true, transaction: { to: executor, data, gas } satisfies PreparedExecution };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { executable: false, retryable: true, reason };
      }
    },
    async pendingNonce() { return publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }); },
    async submit(transaction, nonce, mode) {
      const prepared = transaction as PreparedExecution;
      const fees = await publicClient.estimateFeesPerGas();
      const bump = mode === "replacement" ? 120n : 100n;
      const hash = await walletClient.sendTransaction({ account, chain, to: prepared.to, data: prepared.data, gas: prepared.gas, nonce,
        maxFeePerGas: fees.maxFeePerGas ? fees.maxFeePerGas * bump / 100n : undefined,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ? fees.maxPriorityFeePerGas * bump / 100n : undefined,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("ASSISTANCE_FUND_BUYBACK_REVERTED");
      console.log(JSON.stringify({ service: "keeper", component: "assistance-fund", action: "buyback-burn", hash }));
      return hash;
    },
  };

  const keeper = new AssistanceFundKeeper(port, 1);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loop = async () => {
    if (stopped) return;
    try {
      await collectRevenue();
      await keeper.runOnce();
    } catch (error) {
      console.error(JSON.stringify({ service: "keeper", component: "assistance-fund", status: "error", error: error instanceof Error ? error.message : String(error) }));
    } finally {
      if (!stopped) timer = setTimeout(() => void loop(), pollMs);
    }
  };
  void loop();
  return async () => { stopped = true; if (timer) clearTimeout(timer); };
}
