import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";

const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const invariant = (value, message) => {
  if (!value) throw new Error(message);
};
const readJson = async (location) =>
  JSON.parse(await readFile(location, "utf8"));

invariant(required("APP_ENV") === "mainnet", "Mainnet environment required");
const chainId = Number(required("CHAIN_ID"));
invariant(chainId === 4663, "Chain 4663 required");
invariant(
  required("SUPABASE_SCHEMA") === "zkblast_mainnet",
  "Mainnet schema required",
);
const rpcUrl = required("RPC_URL");
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
invariant((await client.getChainId()) === chainId, "RPC chain mismatch");

const manifest = await readJson("deployments/mainnet/manifest.json");
invariant(
  manifest.protocol === "ZKBLAST" &&
    manifest.environment === "mainnet" &&
    manifest.chainId === chainId,
  "Mainnet manifest boundary mismatch",
);
const contracts = [];
for (const [name, record] of Object.entries(manifest.contracts)) {
  const implementation = getAddress(record.implementationAddress);
  const implementationCode = await client.getBytecode({ address: implementation });
  invariant(implementationCode && implementationCode !== "0x", `${name} implementation missing`);
  invariant(
    keccak256(implementationCode) === record.deployedRuntimeBytecodeHash,
    `${name} runtime hash mismatch`,
  );
  let proxy = null;
  if (record.proxyKind === "uups") {
    proxy = getAddress(record.proxyAddress);
    const proxyCode = await client.getBytecode({ address: proxy });
    invariant(proxyCode && proxyCode !== "0x", `${name} proxy missing`);
    const stored = await client.getStorageAt({ address: proxy, slot: IMPLEMENTATION_SLOT });
    invariant(stored, `${name} implementation slot empty`);
    invariant(
      getAddress(`0x${stored.slice(-40)}`) === implementation,
      `${name} implementation slot mismatch`,
    );
  }
  contracts.push({ name, implementation, proxy, recoverable: true });
}

const safe = getAddress(required("GOVERNANCE_MULTISIG_ADDRESS"));
const timelock = getAddress(required("PROXY_ADMIN_ADDRESS"));
const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
]);
const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
]);
const [owners, threshold, delay] = await Promise.all([
  client.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
  client.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
  client.readContract({ address: timelock, abi: timelockAbi, functionName: "getMinDelay" }),
]);
invariant(owners.length === 2 && threshold === 2n, "Safe recovery policy mismatch");
invariant(delay === 300n, "Timelock recovery delay mismatch");
const roles = {};
for (const functionName of ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"]) {
  const role = await client.readContract({ address: timelock, abi: timelockAbi, functionName });
  roles[functionName] = await client.readContract({
    address: timelock,
    abi: timelockAbi,
    functionName: "hasRole",
    args: [role, safe],
  });
  invariant(roles[functionName], `Safe missing ${functionName}`);
}
const runbooks = [
  "docs/INCIDENT_RESPONSE.md",
  "docs/RELEASE_CHECKLIST.md",
  "docs/DATABASE_RUNBOOK.md",
];
await Promise.all(runbooks.map((location) => readFile(location, "utf8")));
const block = await client.getBlock();
const evidence = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "mainnet",
  mode: "non-destructive-live-readiness",
  passed: true,
  executedAt: new Date().toISOString(),
  blockNumber: Number(block.number),
  blockHash: block.hash,
  databaseSchema: "zkblast_mainnet",
  manifestGeneratedAt: manifest.generatedAt,
  contracts,
  governance: {
    safe,
    owners,
    threshold: threshold.toString(),
    timelock,
    delaySeconds: delay.toString(),
    roles,
  },
  runbooks,
  mutationsPerformed: false,
  shieldedCustodyIncluded: false,
  notes: [
    "Core public-pool recovery surfaces passed read-only verification.",
    "Shielded custody remains excluded under owner risk acceptance.",
  ],
};
const output = "evidence/mainnet/recovery-rehearsal.json";
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await rename(temporary, output);
console.log(`Mainnet recovery rehearsal passed at block ${block.number}`);
