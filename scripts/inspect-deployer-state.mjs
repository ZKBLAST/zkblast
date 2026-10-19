import process from "node:process";

import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const environment = process.argv[2];
if (environment !== "testnet" && environment !== "mainnet")
  throw new Error("Environment argument must be testnet or mainnet");
const key = process.env.DEPLOYER_PRIVATE_KEY?.trim();
if (!/^0x[\da-f]{64}$/iu.test(key ?? ""))
  throw new Error("DEPLOYER_PRIVATE_KEY is missing or invalid");
const account = privateKeyToAccount(key);
const rpcUrl = process.env.RPC_URL?.trim();
if (!rpcUrl) throw new Error("RPC_URL is required");
const client = createPublicClient({ transport: http(rpcUrl) });
const [chainId, confirmedNonce, pendingNonce, balance] = await Promise.all([
  client.getChainId(),
  client.getTransactionCount({ address: account.address }),
  client.getTransactionCount({ address: account.address, blockTag: "pending" }),
  client.getBalance({ address: account.address }),
]);
console.log(
  JSON.stringify({
    environment,
    chainId,
    address: account.address,
    confirmedNonce,
    pendingNonce,
    funded: balance > 0n,
  }),
);
