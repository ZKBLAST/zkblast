import process from "node:process";

import { createPublicClient, getAddress, http, parseAbi } from "viem";

const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet")
  throw new Error("APP_ENV must be testnet or mainnet");
const expectedChainId = environment === "testnet" ? 46_630 : 4_663;
const expected = [
  {
    key: "EXECUTION_USDG_ADDRESS",
    symbol: "USDG",
    decimals: 6,
  },
  {
    key: "EXECUTION_WETH_ADDRESS",
    symbol: "WETH",
    decimals: 18,
  },
];
const rpcUrl = process.env.RPC_URL?.trim();
if (!rpcUrl) throw new Error("RPC_URL is required");
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== expectedChainId)
  throw new Error(`${environment}: execution asset RPC chain mismatch`);
const abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const assets = [];
for (const item of expected) {
  const rawAddress = process.env[item.key]?.trim();
  if (!rawAddress) throw new Error(`${item.key} is required`);
  const address = getAddress(rawAddress);
  const [code, symbol, decimals] = await Promise.all([
    client.getBytecode({ address }),
    client.readContract({ address, abi, functionName: "symbol" }),
    client.readContract({ address, abi, functionName: "decimals" }),
  ]);
  if (!code || code === "0x")
    throw new Error(`${item.key} has no runtime code`);
  if (symbol !== item.symbol || decimals !== item.decimals)
    throw new Error(`${item.key} metadata mismatch`);
  assets.push({ address, symbol, decimals, codePresent: true });
}
console.log(
  JSON.stringify({ environment, chainId: expectedChainId, assets }, null, 2),
);
