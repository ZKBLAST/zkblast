import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/elysium-testnet");
const read = async <T>(relativePath: string): Promise<T> => JSON.parse(await readFile(path.join(directory, relativePath), "utf8")) as T;
type Plan = { planSha256: string; transactionCount: number; startingNonce: number; nextNonce: number; addresses: Record<string, Address>; capabilities?: Record<string, unknown> };
type Simulation = { sourcePlanSha256: string; transactionCount: number; totalGasUsed: string; passed: boolean; broadcastAllowed: boolean };
const preflight = await read<{ chain: { chainId: number; blockNumber: number; blockHash: string; gasPriceWei: string }; deployer: { address: Address; pendingNonce: number }; governancePlan: { predictedTimelock: Address; minimumDelaySeconds: string } }>("preflight.json");
const dbc = await read<Plan>("dbc-deployment-plan.json");
const launchpad = await read<Plan>("launchpad-deployment-plan.json");
const protectedLaunch = await read<Plan>("protected-launch/deployment-plan.json");
const dbcSimulation = await read<Simulation>("dbc-deployment-simulation.json");
const launchpadSimulation = await read<Simulation>("launchpad-deployment-simulation.json");
const protectedSimulation = await read<Simulation>("protected-launch/deployment-simulation.json");
const pairs = [[dbc, dbcSimulation], [launchpad, launchpadSimulation], [protectedLaunch, protectedSimulation]] as const;
if (preflight.chain.chainId !== 99_801 || preflight.deployer.pendingNonce !== 0) throw new Error("ELYSIUM_MANIFEST_PREFLIGHT_INVALID");
for (const [plan, simulation] of pairs) {
  if (!simulation.passed || simulation.broadcastAllowed || simulation.sourcePlanSha256 !== plan.planSha256 || simulation.transactionCount !== plan.transactionCount) throw new Error("ELYSIUM_MANIFEST_SIMULATION_INVALID");
}
if (dbc.startingNonce !== 1 || dbc.nextNonce !== launchpad.startingNonce || launchpad.nextNonce !== protectedLaunch.startingNonce || protectedLaunch.nextNonce !== 63) throw new Error("ELYSIUM_MANIFEST_NONCE_SEQUENCE_INVALID");
const timelockGasUsed = 1_356_855n;
const planGasUsed = [dbcSimulation, launchpadSimulation, protectedSimulation].reduce((total, simulation) => total + BigInt(simulation.totalGasUsed), 0n);
const combinedGasUsed = timelockGasUsed + planGasUsed;
const sampledGasPriceWei = BigInt(preflight.chain.gasPriceWei);
const measuredCostWei = combinedGasUsed * sampledGasPriceWei;
const recommendedMaximumSpendWei = measuredCostWei * 125n / 100n;
const unsigned = {
  schemaVersion: 1,
  kind: "elysium-testnet-manifest-candidate",
  generatedAt: new Date().toISOString(),
  chainId: 99_801,
  environment: "testnet",
  referenceBlock: preflight.chain.blockNumber,
  referenceBlockHash: preflight.chain.blockHash,
  deployer: preflight.deployer.address,
  governance: { timelock: preflight.governancePlan.predictedTimelock, minimumDelaySeconds: preflight.governancePlan.minimumDelaySeconds },
  transactionCount: 63,
  startingNonce: 0,
  nextNonce: 63,
  plans: {
    dbc: { sha256: dbc.planSha256, transactionCount: dbc.transactionCount, addresses: dbc.addresses },
    launchpad: { sha256: launchpad.planSha256, transactionCount: launchpad.transactionCount, addresses: launchpad.addresses },
    protectedLaunch: { sha256: protectedLaunch.planSha256, transactionCount: protectedLaunch.transactionCount, addresses: protectedLaunch.addresses },
  },
  gas: {
    timelockGasUsed: timelockGasUsed.toString(),
    planGasUsed: planGasUsed.toString(),
    combinedGasUsed: combinedGasUsed.toString(),
    sampledGasPriceWei: sampledGasPriceWei.toString(),
    measuredCostWei: measuredCostWei.toString(),
    recommendedMaximumSpendWei: recommendedMaximumSpendWei.toString(),
    retryBufferBps: 2_500,
  },
  capabilities: { dbc: true, launchpad: true, protectedLaunch: true, graduation: false, graduationStatus: "pending-adapter", publicDeployment: false },
  gates: { localForkAccepted: true, publicBroadcastApproved: false, broadcastAllowed: false },
};
const candidate = { ...unsigned, candidateSha256: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex") };
await writeFile(path.join(directory, "manifest-candidate.json"), `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: candidate.transactionCount, combinedGasUsed: candidate.gas.combinedGasUsed, measuredCostWei: candidate.gas.measuredCostWei, recommendedMaximumSpendWei: candidate.gas.recommendedMaximumSpendWei, candidateSha256: candidate.candidateSha256, broadcastAllowed: false }, null, 2));
