import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, keccak256, type Address, type Hex } from "viem";

type Transaction = Readonly<{
  index: number;
  nonce: number;
  name: string;
  predictedContractAddress?: Address;
  data: Hex;
  dataHash: Hex;
  dataBytes: number;
  estimatedGas: string;
  evidence: string;
}>;

const root = path.resolve(import.meta.dirname, "../../..");
const directory = path.join(root, "deployments/hyperevm-mainnet");
const previous = JSON.parse(await readFile(path.join(directory, "core-deployment-plan.json"), "utf8")) as {
  chainId: number;
  deployer: Address;
  governance: Address;
  upgrader: Address;
  addresses: Record<string, Address>;
  transactions: Transaction[];
};
if (previous.chainId !== 999 || getAddress(previous.deployer) !== getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B")) {
  throw new Error("HYPEREVM_CORE_RESUME_CONTEXT_INVALID");
}
const artifact = JSON.parse(await readFile(path.join(root, "packages/contracts/out/HyperEvmDammPoolFactory.sol/HyperEvmDammPoolFactory.json"), "utf8")) as { bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const originalFactory = previous.transactions.find((transaction) => transaction.nonce === 3);
if (!originalFactory) throw new Error("HYPEREVM_CORE_RESUME_FACTORY_TRANSACTION_MISSING");
const factoryData = artifact.bytecode.object;
const factoryTransaction: Transaction = {
  ...originalFactory,
  name: "hyperEvmDammPoolFactoryImplementation",
  data: factoryData,
  dataHash: keccak256(factoryData),
  dataBytes: (factoryData.length - 2) / 2,
  estimatedGas: "2571927",
  evidence: "chain-999 eth_estimateGas at pending nonce 3",
};
const transactions = [factoryTransaction, ...previous.transactions.filter((transaction) => transaction.nonce >= 4)];
if (transactions.length !== 7 || transactions.some((transaction, index) => transaction.nonce !== index + 3)) {
  throw new Error("HYPEREVM_CORE_RESUME_NONCE_SEQUENCE_INVALID");
}
const report = {
  schemaVersion: 1,
  chainId: 999,
  kind: "partial-core-resume-plan",
  generatedAt: new Date().toISOString(),
  sourcePlanSha256: "796f14804049a0b8a24e42d07506a3e2590aa9a788a4120435b00560659a15b3",
  deployer: previous.deployer,
  governance: previous.governance,
  upgrader: previous.upgrader,
  startingNonce: 3,
  nextNonce: 10,
  transactionCount: transactions.length,
  preservedConfirmedNonces: [0, 1, 2],
  addresses: previous.addresses,
  implementation: {
    contract: "HyperEvmDammPoolFactory",
    dlmmEnabled: false,
    creationBytecodeHash: keccak256(artifact.bytecode.object),
    runtimeBytecodeHash: keccak256(artifact.deployedBytecode.object),
  },
  transactions,
  planSha256: "",
  gates: { privateKeysRead: false, broadcastAllowed: false, forkSimulationPassed: false },
};
report.planSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
await writeFile(path.join(directory, "core-resume-plan.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ startingNonce: 3, nextNonce: 10, transactionCount: 7, factory: previous.addresses.poolFactory, implementation: previous.addresses.poolFactoryImplementation, factoryDeploymentGas: factoryTransaction.estimatedGas, planSha256: report.planSha256, broadcastAllowed: false }, null, 2));
