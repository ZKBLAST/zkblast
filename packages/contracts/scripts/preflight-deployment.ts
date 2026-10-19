import process from "node:process";
import {
  createPublicClient,
  defineChain,
  formatEther,
  getAddress,
  http,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const environment = required("APP_ENV");
if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("APP_ENV must be testnet or mainnet");
}

const chainId = Number(required("CHAIN_ID"));
if (!Number.isSafeInteger(chainId) || chainId <= 0)
  throw new Error("CHAIN_ID is invalid");
const privateKey = required("DEPLOYER_PRIVATE_KEY");
if (!/^0x[\da-f]{64}$/iu.test(privateKey))
  throw new Error("DEPLOYER_PRIVATE_KEY is invalid");

const governance = getAddress(required("GOVERNANCE_MULTISIG_ADDRESS"));
const upgrader = getAddress(required("PROXY_ADMIN_ADDRESS"));
if (governance === zeroAddress || upgrader === zeroAddress) {
  throw new Error("Governance and upgrader addresses must not be zero");
}
if (governance === upgrader) {
  throw new Error("Governance and upgrader must be separate addresses");
}

const account = privateKeyToAccount(privateKey as Hex);
const rpcUrl = required("RPC_URL");
const explorerUrl = new URL(required("BLOCK_EXPLORER_URL"));
if (explorerUrl.protocol !== "https:") {
  throw new Error("BLOCK_EXPLORER_URL must use HTTPS");
}
const chain = defineChain({
  id: chainId,
  name: required("CHAIN_NAME"),
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl) });
let networkState: readonly [number, bigint, Hex | undefined, Hex | undefined];
try {
  networkState = await Promise.all([
    client.getChainId(),
    client.getBalance({ address: account.address }),
    client.getBytecode({ address: governance }),
    client.getBytecode({ address: upgrader }),
  ]);
} catch {
  throw new Error("RPC connectivity check failed; endpoint details redacted");
}
const [actualChainId, balance, governanceCode, upgraderCode] = networkState;

if (actualChainId !== chainId) {
  throw new Error(
    `RPC chain mismatch: expected ${chainId}, received ${actualChainId}`,
  );
}
if (balance === 0n)
  throw new Error(`Deployer ${account.address} has zero native balance`);

try {
  const response = await fetch(explorerUrl, {
    headers: {
      accept: "text/html",
      "user-agent": "ZKBLAST-Deployment-Preflight/1.0",
    },
  });
  if (!response.ok) throw new Error("response not successful");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html"))
    throw new Error("invalid explorer response");
} catch {
  throw new Error("Explorer availability check failed; endpoint details redacted");
}

if (environment === "mainnet") {
  if (!governanceCode || governanceCode === "0x") {
    throw new Error("Mainnet governance must be a deployed multisig contract");
  }
  if (!upgraderCode || upgraderCode === "0x") {
    throw new Error("Mainnet upgrader must be a deployed timelock contract");
  }
  const minimumDelay = BigInt(required("MIN_TIMELOCK_DELAY_SECONDS"));
  const [owners, threshold] = await Promise.all([
    client.readContract({
      address: governance,
      abi: [
        {
          type: "function",
          name: "getOwners",
          inputs: [],
          outputs: [{ type: "address[]" }],
          stateMutability: "view",
        },
      ],
      functionName: "getOwners",
    }),
    client.readContract({
      address: governance,
      abi: [
        {
          type: "function",
          name: "getThreshold",
          inputs: [],
          outputs: [{ type: "uint256" }],
          stateMutability: "view",
        },
      ],
      functionName: "getThreshold",
    }),
  ]);
  if (
    owners.length < 2 ||
    threshold < 2n ||
    threshold > BigInt(owners.length)
  ) {
    throw new Error(
      "Mainnet governance Safe requires at least two owners and threshold two",
    );
  }
  const configuredDelay = await client.readContract({
    address: upgrader,
    abi: [
      {
        type: "function",
        name: "getMinDelay",
        inputs: [],
        outputs: [{ type: "uint256" }],
        stateMutability: "view",
      },
    ],
    functionName: "getMinDelay",
  });
  if (configuredDelay < minimumDelay) {
    throw new Error(
      `Mainnet timelock delay is too short: expected at least ${minimumDelay} seconds`,
    );
  }
  const timelockRoleAbi = [
    {
      type: "function",
      name: "PROPOSER_ROLE",
      inputs: [],
      outputs: [{ type: "bytes32" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "EXECUTOR_ROLE",
      inputs: [],
      outputs: [{ type: "bytes32" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "CANCELLER_ROLE",
      inputs: [],
      outputs: [{ type: "bytes32" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "hasRole",
      inputs: [{ type: "bytes32" }, { type: "address" }],
      outputs: [{ type: "bool" }],
      stateMutability: "view",
    },
  ] as const;
  for (const functionName of [
    "PROPOSER_ROLE",
    "EXECUTOR_ROLE",
    "CANCELLER_ROLE",
  ] as const) {
    const role = await client.readContract({
      address: upgrader,
      abi: timelockRoleAbi,
      functionName,
    });
    const assigned = await client.readContract({
      address: upgrader,
      abi: timelockRoleAbi,
      functionName: "hasRole",
      args: [role, governance],
    });
    if (!assigned)
      throw new Error(
        `Mainnet timelock ${functionName} is not assigned to governance`,
      );
  }
}

console.log(`Deployment preflight passed: ${environment} chain ${chainId}`);
console.log(`Deployer: ${account.address}`);
console.log(`Native balance: ${formatEther(balance)}`);
console.log(
  `Governance account type: ${governanceCode && governanceCode !== "0x" ? "contract" : "EOA"}`,
);
console.log(
  `Upgrader account type: ${upgraderCode && upgraderCode !== "0x" ? "contract" : "EOA"}`,
);
