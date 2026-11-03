import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { encodeDeployData, encodeFunctionData, getContractAddress, keccak256, type Abi, type Address, type Hex } from "viem";

type Artifact = Readonly<{ abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } }>;
const root = path.resolve(import.meta.dirname, "../../..");
const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(root, file), "utf8")) as T;
const launchpad = await readJson<{ chainId: number; deployer: Address; governance: Address; upgrader: Address; nextNonce: number; gates: { broadcastAllowed: boolean } }>("deployments/hyperevm-mainnet/launchpad-deployment-plan.json");
if (launchpad.chainId !== 999 || launchpad.nextNonce !== 55 || launchpad.gates.broadcastAllowed) throw new Error("HYPEREVM_LAUNCHPAD_PLAN_CONTEXT_INVALID");
const registry = await readJson<Artifact>("packages/contracts/out-hyperevm/GraduationAdapterRegistry.sol/GraduationAdapterRegistry.json");
const proxy = await readJson<Artifact>("packages/contracts/out-hyperevm/ERC1967Proxy.sol/ERC1967Proxy.json");
const implementation = getContractAddress({ from: launchpad.deployer, nonce: 55n });
const registryProxy = getContractAddress({ from: launchpad.deployer, nonce: 56n });
const initialize = encodeFunctionData({ abi: registry.abi, functionName: "initialize", args: [launchpad.governance, launchpad.upgrader] });
const implementationData = registry.bytecode.object;
const proxyData = encodeDeployData({ abi: proxy.abi, bytecode: proxy.bytecode.object, args: [implementation, initialize] });
const report = {
  schemaVersion: 1, chainId: 999, kind: "offline-graduation-adapter-registry-plan", generatedAt: new Date().toISOString(),
  deployer: launchpad.deployer, governance: launchpad.governance, upgrader: launchpad.upgrader,
  startingNonce: 55, nextNonce: 57, transactionCount: 2,
  addresses: { implementation, registry: registryProxy },
  transactions: [
    { nonce: 55, name: "graduationAdapterRegistryImplementation", predictedContractAddress: implementation, data: implementationData, dataHash: keccak256(implementationData), dataBytes: (implementationData.length - 2) / 2 },
    { nonce: 56, name: "graduationAdapterRegistry", predictedContractAddress: registryProxy, data: proxyData, dataHash: keccak256(proxyData), dataBytes: (proxyData.length - 2) / 2 },
  ],
  initializerHash: keccak256(initialize),
  adapterRegistration: { planned: false, reason: "No fabricated reviewReferenceHash; registration remains disabled until an explicit truthful review decision exists." },
  planSha256: "", gates: { privateKeysRead: false, broadcastAllowed: false, sequentialSimulationPassed: false, adapterRegistered: false },
};
report.planSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
await writeFile(path.join(root, "deployments/hyperevm-mainnet/adapter-registry-deployment-plan.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: 2, startingNonce: 55, nextNonce: 57, implementation, registry: registryProxy, adapterRegistrationPlanned: false, planSha256: report.planSha256, broadcastAllowed: false }, null, 2));
