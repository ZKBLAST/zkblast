import { createPublicClient, http, keccak256, parseAbi, stringToHex } from "viem";

const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const PROXIES = {
  LaunchConfigRegistry: "0xd680c010873257f05EAAbdde583b2d6DE4FA6e33",
  LaunchFactory: "0xB6BD21A7E9E573F30f0e5175551Ab1be009a545B",
  LaunchpadRouter: "0x6d208744Ff0Ec74b04Bb76576b32A8A2ccB9f181",
  LPAllocationEscrow: "0x13A41EEE494b198d8F5E428283a0A274699C9b60",
  GraduationManager: "0x7DD70C9C9DFA592a4d1617F6cb2e8DB816eCd37c",
};

const DIRECT_CONTRACTS = {
  LaunchTokenDeployer: "0x763290A45dde9527e2713e41231bB02b0391106f",
  ManifestVirtualPoolDeployer: "0xBE32DBc3f0f758B0b51F510A695DEa5Ed8d211c4",
  BriefVirtualPoolDeployer: "0x3086f8699ca40aFAb009A6156efb75aF4612E10f",
  CurveQuoter: "0x9327DA0628a441463C7101eFBc02d37E01585e21",
  DammGraduationAdapter: "0xC8A115392EF415738a21C918b02Eff95970FDd89",
  ZKBLAST: "0x3f9ff9f1d40369f99c281375bd19d6ecbebfecd7",
};

const GOVERNANCE = "0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8";
const TIMELOCK = "0x5D096a502e72bcD429b9E4A4907095Ee3931BD4d";
const LAUNCHPAD = {
  FeeController: "0x0B7de982ecEab02b25bFcdc88581f3FF133FfDE1",
  RevenueSplitter: "0xB7582AE80429357E58b8E43B9B91Cd4485B99C96",
  FeeCollector: "0x4238729198c97394ca7F1d49ADC3468313E0800e",
};
const ZKBLAST_POOL = "0xe6197894d4d4a4e0b1eef50501d1e9c3dd37bd9f";

const accessAbi = parseAbi(["function hasRole(bytes32,address) view returns (bool)"]);
const launchFactoryAbi = parseAbi([
  "function registry() view returns (address)",
  "function tokenDeployer() view returns (address)",
  "function poolDeployer() view returns (address)",
  "function graduationManager() view returns (address)",
]);
const feeControllerAbi = parseAbi(["function protocolRecipient() view returns (address)"]);
const feeCollectorAbi = parseAbi(["function revenueSplitter() view returns (address)"]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function protocolFeeRecipient() view returns (address)",
  "function protocolFees0() view returns (uint128)",
  "function protocolFees1() view returns (uint128)",
]);

function byteLength(code) {
  return code ? (code.length - 2) / 2 : 0;
}

function implementationAddress(storageValue) {
  return storageValue ? `0x${storageValue.slice(-40)}` : null;
}

function selectorPresence(code) {
  return {
    burn: code.includes("42966c68"),
    burnFrom: code.includes("79cc6790"),
    totalSupply: code.includes("18160ddd"),
    mint: code.includes("40c10f19"),
  };
}

const rpcCandidates = [
  process.env.RPC_URL,
  process.env.ROBINHOOD_PUBLIC_RPC_URL,
  "https://rpc.mainnet.chain.robinhood.com",
].filter((value, index, values) => value && values.indexOf(value) === index);

let client;
let chainId;
for (const rpcUrl of rpcCandidates) {
  const candidate = createPublicClient({ transport: http(rpcUrl) });
  try {
    const candidateChainId = await candidate.getChainId();
    if (candidateChainId !== 4663) continue;
    client = candidate;
    chainId = candidateChainId;
    break;
  } catch {
    // Never print an endpoint: provider URLs can contain private API keys.
  }
}
if (!client) throw new Error("No healthy Robinhood Chain mainnet RPC is available");

const result = {
  chainId,
  referenceBlock: (await client.getBlockNumber()).toString(),
  proxies: {},
  directContracts: {},
  bindings: {},
  roleChecks: {},
  token: {},
  candidatePool: {},
};

for (const [name, address] of Object.entries(PROXIES)) {
  const [proxyCode, rawImplementation] = await Promise.all([
    client.getCode({ address }),
    client.getStorageAt({ address, slot: IMPLEMENTATION_SLOT }),
  ]);
  const implementation = implementationAddress(rawImplementation);
  const implementationCode = implementation
    ? await client.getCode({ address: implementation })
    : undefined;
  result.proxies[name] = {
    address,
    codeBytes: byteLength(proxyCode),
    implementation,
    implementationCodeBytes: byteLength(implementationCode),
  };
}

for (const [name, address] of Object.entries(DIRECT_CONTRACTS)) {
  const code = await client.getCode({ address });
  result.directContracts[name] = {
    address,
    codeBytes: byteLength(code),
    codeHash: code ? keccak256(code) : null,
    ...(name === "ZKBLAST" && code ? { selectors: selectorPresence(code) } : {}),
  };
}

const read = (address, abi, functionName, args = []) =>
  client.readContract({ address, abi, functionName, args });
const launchFactory = PROXIES.LaunchFactory;
result.bindings = {
  registry: await read(launchFactory, launchFactoryAbi, "registry"),
  tokenDeployer: await read(launchFactory, launchFactoryAbi, "tokenDeployer"),
  poolDeployer: await read(launchFactory, launchFactoryAbi, "poolDeployer"),
  graduationManager: await read(launchFactory, launchFactoryAbi, "graduationManager"),
  launchpadProtocolRecipient: await read(
    LAUNCHPAD.FeeController,
    feeControllerAbi,
    "protocolRecipient",
  ),
  launchpadRevenueSplitter: await read(
    LAUNCHPAD.FeeCollector,
    feeCollectorAbi,
    "revenueSplitter",
  ),
};

const adminRole = `0x${"00".repeat(32)}`;
const upgraderRole = keccak256(stringToHex("ZKBLAST_UPGRADER_ROLE"));
for (const [name, address] of Object.entries({ ...PROXIES, ...LAUNCHPAD })) {
  result.roleChecks[name] = {
    governanceIsAdmin: await read(address, accessAbi, "hasRole", [adminRole, GOVERNANCE]),
    timelockIsUpgrader: await read(address, accessAbi, "hasRole", [upgraderRole, TIMELOCK]),
  };
}

const tokenAddress = DIRECT_CONTRACTS.ZKBLAST;
result.token = {
  address: tokenAddress,
  name: await read(tokenAddress, tokenAbi, "name"),
  symbol: await read(tokenAddress, tokenAbi, "symbol"),
  decimals: await read(tokenAddress, tokenAbi, "decimals"),
  totalSupply: (await read(tokenAddress, tokenAbi, "totalSupply")).toString(),
};

result.candidatePool = {
  address: ZKBLAST_POOL,
  token0: await read(ZKBLAST_POOL, poolAbi, "token0"),
  token1: await read(ZKBLAST_POOL, poolAbi, "token1"),
  protocolFeeRecipient: await read(
    ZKBLAST_POOL,
    poolAbi,
    "protocolFeeRecipient",
  ),
  protocolFees0: (await read(ZKBLAST_POOL, poolAbi, "protocolFees0")).toString(),
  protocolFees1: (await read(ZKBLAST_POOL, poolAbi, "protocolFees1")).toString(),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
