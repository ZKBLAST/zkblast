import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, formatEther, http, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const environment = process.env.APP_ENV;
if ((environment !== "testnet" && environment !== "mainnet") || !process.env.RPC_URL) {
  throw new Error("PERPS_FEE_ENV_INVALID");
}
const planPath = path.join(root, `deployments/${environment}/perps-v1-plan.json`);
const planBytes = await readFile(planPath);
const plan = JSON.parse(planBytes.toString("utf8")) as {
  chainId: number; referenceBlock: string; deployer: `0x${string}`;
  order: string[]; sourceArtifacts: Record<string, unknown>;
};
const client = createPublicClient({ transport: http(process.env.RPC_URL, { timeout: 20_000, retryCount: 1 }) });
const [chainId, gasPriceWei, balanceWei, block] = await Promise.all([
  client.getChainId(), client.getGasPrice(), client.getBalance({ address: plan.deployer }), client.getBlock(),
]);
if (chainId !== plan.chainId) throw new Error("PERPS_FEE_CHAIN_MISMATCH");
const artifactName = (step: string) => {
  if (step.endsWith("Proxy")) return "ERC1967Proxy";
  if (step.endsWith("Implementation")) return step.slice(0, -"Implementation".length);
  return step;
};
const artifactRoot = path.join(root, "packages/contracts/out");
const sourceFile = (name: string) => name.startsWith("PrivatePerp") ? "PrivatePerpProofVerifiers" : name;
const stages = [];
for (const step of plan.order) {
  const name = artifactName(step);
  const artifact = JSON.parse(await readFile(
    path.join(artifactRoot, `${sourceFile(name)}.sol`, `${name}.json`), "utf8",
  )) as { bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
  const creationBytes = (artifact.bytecode.object.length - 2) / 2;
  const runtimeBytes = (artifact.deployedBytecode.object.length - 2) / 2;
  // Conservative CREATE model: intrinsic + calldata + code deposit + constructor/delegatecall reserve.
  const constructorReserve = step.endsWith("Proxy") ? 650_000n : step.startsWith("PrivatePerp") ? 180_000n : 300_000n;
  const estimatedGas = 53_000n + BigInt(creationBytes * 16) + BigInt(runtimeBytes * 200) + constructorReserve;
  stages.push({ step, artifact: name, creationBytes, runtimeBytes, estimatedGas: estimatedGas.toString() });
}
const modeledGas = stages.reduce((sum, stage) => sum + BigInt(stage.estimatedGas), 0n);
const bufferedGas = (modeledGas * 125n + 99n) / 100n;
const gasPriceCapWei = gasPriceWei * 2n;
const recommendedFeeCeilingWei = bufferedGas * gasPriceCapWei;
const report = {
  schemaVersion: 1,
  environment,
  chainId,
  referenceBlock: block.number.toString(),
  planSha256: createHash("sha256").update(planBytes).digest("hex"),
  transactionCount: stages.length,
  liveGasPriceWei: gasPriceWei.toString(),
  gasPriceCapWei: gasPriceCapWei.toString(),
  modeledGas: modeledGas.toString(),
  bufferedGas: bufferedGas.toString(),
  estimatedFeeEth: formatEther(modeledGas * gasPriceWei),
  recommendedFeeCeilingEth: formatEther(recommendedFeeCeilingWei),
  deployerBalanceEth: formatEther(balanceWei),
  balanceCoversCeiling: balanceWei >= recommendedFeeCeilingWei,
  methodology: "conservative-bytecode-create-model-125pct-gas-2x-price-cap",
  broadcastAllowed: false,
  stages,
};
await writeFile(
  path.join(root, `deployments/${environment}/perps-v1-fee-preflight.json`),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify({
  environment, chainId, referenceBlock: report.referenceBlock,
  transactionCount: stages.length, modeledGas: report.modeledGas,
  estimatedFeeEth: report.estimatedFeeEth,
  recommendedFeeCeilingEth: report.recommendedFeeCeilingEth,
  deployerBalanceEth: report.deployerBalanceEth,
  balanceCoversCeiling: report.balanceCoversCeiling,
  broadcastAllowed: false,
}));
