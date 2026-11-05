import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatEther, getAddress, type Hex } from "viem";

const root = path.resolve(import.meta.dirname, "../../..");
const lines = (await readFile(path.join(root, ".env.mainnet"), "utf8")).split(/\r?\n/u);
const values = new Map<string, string>();
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator <= 0) continue;
  const key = trimmed.slice(0, separator).trim();
  const raw = trimmed.slice(separator + 1).trim();
  values.set(key, raw.replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2"));
}
const rpcUrl = values.get("RPC_URL");
const fallbackUrls = (values.get("RPC_FALLBACK_URLS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const deployer = getAddress("0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B");
if (!rpcUrl || Number(values.get("CHAIN_ID")) !== 4663 || values.get("APP_ENV") !== "mainnet") {
  throw new Error("ASSISTANCE_FUND_PREFLIGHT_CONTEXT_INVALID");
}

let requestId = 0;
let activeRpcIndex = 0;
const rpcUrls = [rpcUrl, ...fallbackUrls];
async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  let lastError = "no endpoint";
  for (let offset = 0; offset < rpcUrls.length; offset++) {
    const index = (activeRpcIndex + offset) % rpcUrls.length;
    try {
      const response = await fetch(rpcUrls[index]!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      });
      const body = await response.json() as { result?: T; error?: { message: string } };
      if (body.error || body.result === undefined) {
        lastError = body.error?.message ?? "missing result";
        continue;
      }
      activeRpcIndex = index;
      return body.result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`ASSISTANCE_FUND_PREFLIGHT_RPC_FAILED:${method}:${lastError}`);
}

const [chainIdHex, nonceHex, balanceHex, gasPriceHex] = await Promise.all([
  rpc<Hex>("eth_chainId"),
  rpc<Hex>("eth_getTransactionCount", [deployer, "pending"]),
  rpc<Hex>("eth_getBalance", [deployer, "latest"]),
  rpc<Hex>("eth_gasPrice"),
]);
const chainId = Number(BigInt(chainIdHex));
if (chainId !== 4663) throw new Error(`ASSISTANCE_FUND_PREFLIGHT_CHAIN_MISMATCH:${chainId}`);
console.log(JSON.stringify({
  chainId,
  deployer,
  pendingNonce: Number(BigInt(nonceHex)),
  deployerBalanceEth: formatEther(BigInt(balanceHex)),
  gasPriceWei: BigInt(gasPriceHex).toString(),
  rpcFallbackUsed: activeRpcIndex > 0,
  readOnly: true,
}, null, 2));
