import { createHash } from "node:crypto";
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

const root = process.cwd();
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const check = (value, message) => {
  if (!value) throw new Error(message);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = async (location) => readFile(path.resolve(root, location), "utf8");

check(required("APP_ENV") === "testnet", "Rehearsal is testnet-only");
const chainId = Number(required("CHAIN_ID"));
check(chainId === 46630, "Rehearsal requires chain 46630");
const rpcUrl = required("RPC_URL");
const manifestLocation = required("DEPLOYMENT_MANIFEST_PATH");
check(
  manifestLocation === "deployments/testnet/manifest.json",
  "Manifest path is not testnet-bound",
);
const manifestText = await read(manifestLocation);
const manifest = JSON.parse(manifestText);
const vault = getAddress(manifest.shielded.vault);
const registry = getAddress(manifest.shielded.stateRegistry);
const usdg = getAddress(required("EXECUTION_USDG_ADDRESS"));
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
check((await client.getChainId()) === chainId, "RPC chain mismatch");

const vaultAbi = parseAbi([
  "function paused() view returns (bool)",
  "function assetConfig(address) view returns (uint128 denomination,bool enabled)",
  "function root() view returns (bytes32)",
  "function treeVersion() view returns (uint64)",
]);
const registryAbi = parseAbi([
  "function isKnownRoot(address vault,uint64 version,bytes32 root) view returns (bool)",
]);
const [vaultCode, registryCode, paused, asset, rootValue, treeVersion] =
  await Promise.all([
    client.getBytecode({ address: vault }),
    client.getBytecode({ address: registry }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "assetConfig",
      args: [usdg],
    }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "root" }),
    client.readContract({
      address: vault,
      abi: vaultAbi,
      functionName: "treeVersion",
    }),
  ]);
check(vaultCode && vaultCode !== "0x", "Vault runtime missing");
check(registryCode && registryCode !== "0x", "Registry runtime missing");
check(asset[1] && asset[0] === 1_000_000n, "USDG recovery config mismatch");
const rootAccepted = await client.readContract({
  address: registry,
  abi: registryAbi,
  functionName: "isKnownRoot",
  args: [vault, treeVersion, rootValue],
});
check(rootAccepted, "Current vault root is not recoverable from registry");

const requiredRunbooks = [
  "docs/INCIDENT_RESPONSE.md",
  "docs/DATABASE_ROLLBACK_RUNBOOK.md",
  "docs/DATABASE_RUNBOOK.md",
  "docs/RELEASE_CHECKLIST.md",
];
const runbooks = [];
for (const location of requiredRunbooks) {
  const body = await read(location);
  check(body.trim().length > 100, `${location} is incomplete`);
  runbooks.push({ location, sha256: sha256(body) });
}

const evidence = {
  schemaVersion: 1,
  protocol: "ZKBLAST",
  environment: "testnet",
  chainId,
  performedAt: new Date().toISOString(),
  mode: "non-destructive-live-readiness",
  passed: true,
  scope: [
    "environment and RPC isolation",
    "deployed runtime availability",
    "USDG shielded asset recovery configuration",
    "current commitment root availability",
    "pause-state observation",
    "incident and database recovery runbook integrity",
  ],
  intentionallyNotPerformed: [
    "live emergency pause transaction",
    "live key rotation",
    "destructive database restore",
    "mainnet operation",
  ],
  chain: {
    latestBlock: Number(await client.getBlockNumber()),
    vault,
    vaultRuntimeHash: keccak256(vaultCode),
    stateRegistry: registry,
    stateRegistryRuntimeHash: keccak256(registryCode),
    paused,
    treeVersion: Number(treeVersion),
    currentRoot: rootValue,
    currentRootAccepted: rootAccepted,
    usdg: {
      address: usdg,
      denominationRaw: asset[0].toString(),
      enabled: asset[1],
    },
  },
  manifest: {
    location: manifestLocation,
    sha256: sha256(manifestText),
  },
  runbooks,
  approvalBoundary:
    "This testnet evidence is not a mainnet launch approval or an independent audit.",
};
const output = path.resolve(root, "evidence/testnet/recovery-rehearsal.json");
await mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await rename(temporary, output);
console.log(`Testnet recovery rehearsal passed at block ${evidence.chain.latestBlock}`);

