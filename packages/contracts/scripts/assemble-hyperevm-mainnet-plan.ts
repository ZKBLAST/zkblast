import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Segment = Readonly<{
  chainId: number;
  kind: string;
  deployer: string;
  governance: string;
  upgrader: string;
  startingNonce: number;
  nextNonce: number;
  transactionCount: number;
  planSha256: string;
  addresses: Record<string, string>;
  gates: { broadcastAllowed: boolean; sequentialSimulationPassed: boolean };
}>;
const root = path.resolve(import.meta.dirname, "../../..");
const files = [
  "core-deployment-plan.json",
  "dbc-deployment-plan.json",
  "launchpad-deployment-plan.json",
  "adapter-registry-deployment-plan.json",
] as const;
const segments = await Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(root, "deployments/hyperevm-mainnet", file), "utf8")) as Segment));
const [first] = segments;
if (!first) throw new Error("HYPEREVM_PLAN_EMPTY");
let expectedNonce = first.startingNonce;
const addresses = new Map<string, string>();
for (const segment of segments) {
  if (segment.chainId !== 999 || segment.deployer !== first.deployer || segment.governance !== first.governance || segment.upgrader !== first.upgrader) throw new Error(`HYPEREVM_SEGMENT_CONTEXT_MISMATCH:${segment.kind}`);
  if (segment.startingNonce !== expectedNonce || segment.nextNonce - segment.startingNonce !== segment.transactionCount) throw new Error(`HYPEREVM_NONCE_SEQUENCE_INVALID:${segment.kind}`);
  if (segment.gates.broadcastAllowed || segment.gates.sequentialSimulationPassed) throw new Error(`HYPEREVM_PREMATURE_GATE:${segment.kind}`);
  for (const [name, address] of Object.entries(segment.addresses)) {
    const key = address.toLowerCase();
    const existing = addresses.get(key);
    if (existing) throw new Error(`HYPEREVM_ADDRESS_COLLISION:${existing}:${segment.kind}.${name}`);
    addresses.set(key, `${segment.kind}.${name}`);
  }
  expectedNonce = segment.nextNonce;
}
const report = {
  schemaVersion: 1, chainId: 999, kind: "aggregate-offline-deployment-plan", generatedAt: new Date().toISOString(),
  deployer: first.deployer, governance: first.governance, upgrader: first.upgrader,
  startingNonce: first.startingNonce, nextNonce: expectedNonce,
  transactionCount: segments.reduce((total, segment) => total + segment.transactionCount, 0),
  uniquePredictedAddressCount: addresses.size,
  segments: segments.map((segment, index) => ({ order: index, file: files[index], kind: segment.kind, startingNonce: segment.startingNonce, nextNonce: segment.nextNonce, transactionCount: segment.transactionCount, planSha256: segment.planSha256 })),
  planSha256: "", gates: { privateKeysRead: false, broadcastAllowed: false, sequentialSimulationPassed: false, exactGasEstimateReady: false },
};
report.planSha256 = createHash("sha256").update(JSON.stringify(report)).digest("hex");
await writeFile(path.join(root, "deployments/hyperevm-mainnet/aggregate-deployment-plan.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ transactionCount: report.transactionCount, nonceRange: `${report.startingNonce}-${report.nextNonce - 1}`, nextNonce: report.nextNonce, uniquePredictedAddressCount: report.uniquePredictedAddressCount, segmentCount: report.segments.length, planSha256: report.planSha256, broadcastAllowed: false }, null, 2));
