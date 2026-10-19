import { chmod, readFile, rename, writeFile } from "node:fs/promises";

const sourcePath = ".env.testnet";
const targetPath = ".env.mainnet";

function parse(content) {
  return new Map(
    content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function required(entries, name) {
  const value = entries.get(name)?.trim();
  if (!value) throw new Error(`Testnet source is missing ${name}`);
  return value;
}

function mainnetAlchemyUrl(value, expectedProtocol) {
  const url = new URL(value);
  if (url.protocol !== expectedProtocol)
    throw new Error(`Alchemy URL must use ${expectedProtocol}`);
  if (url.hostname !== "robinhood-testnet.g.alchemy.com")
    throw new Error(
      "Only the validated Robinhood Alchemy testnet host can be converted",
    );
  url.hostname = "robinhood-mainnet.g.alchemy.com";
  return url.toString();
}

async function readHttpChainId(rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_chainId",
      params: [],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Mainnet RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (typeof payload.result !== "string")
    throw new Error("Mainnet RPC returned an invalid response");
  return Number.parseInt(payload.result, 16);
}

async function readWebSocketChainId(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Mainnet WebSocket validation timed out"));
    }, 15_000);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(String(event.data));
      if (payload.id !== 1 || typeof payload.result !== "string") return;
      clearTimeout(timeout);
      socket.close();
      resolve(Number.parseInt(payload.result, 16));
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Mainnet WebSocket validation failed"));
    });
  });
}

function replaceValues(content, updates) {
  const remaining = new Map(updates);
  const lines = content.split(/\r?\n/u).map((line) => {
    if (!line || line.trimStart().startsWith("#")) return line;
    const separator = line.indexOf("=");
    if (separator < 0) return line;
    const key = line.slice(0, separator);
    if (!remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

const [sourceContent, targetContent] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(targetPath, "utf8"),
]);
const source = parse(sourceContent);
if (
  required(source, "APP_ENV") !== "testnet" ||
  required(source, "CHAIN_ID") !== "46630"
)
  throw new Error("Source environment is not Robinhood Chain testnet");
if (required(source, "SUPABASE_SCHEMA") !== "zkblast_testnet")
  throw new Error("Source database schema is not zkblast_testnet");

const rpcUrl = mainnetAlchemyUrl(required(source, "RPC_URL"), "https:");
const wsRpcUrl = mainnetAlchemyUrl(required(source, "WS_RPC_URL"), "wss:");
const [httpChainId, wsChainId] = await Promise.all([
  readHttpChainId(rpcUrl),
  readWebSocketChainId(wsRpcUrl),
]);
if (httpChainId !== 4663 || wsChainId !== 4663)
  throw new Error("Derived endpoints are not Robinhood Chain mainnet");

const updates = new Map([
  ["APP_ENV", "mainnet"],
  ["CHAIN_ID", "4663"],
  ["CHAIN_NAME", "Robinhood Chain"],
  ["RPC_URL", rpcUrl],
  ["WS_RPC_URL", wsRpcUrl],
  ["BLOCK_EXPLORER_URL", "https://robinhoodchain.blockscout.com"],
  ["SUPABASE_URL", required(source, "SUPABASE_URL")],
  ["SUPABASE_ANON_KEY", required(source, "SUPABASE_ANON_KEY")],
  ["SUPABASE_SERVICE_ROLE_KEY", required(source, "SUPABASE_SERVICE_ROLE_KEY")],
  [
    "SUPABASE_DIRECT_DATABASE_URL",
    required(source, "SUPABASE_DIRECT_DATABASE_URL"),
  ],
  ["SUPABASE_SCHEMA", "zkblast_mainnet"],
  ["DEPLOYER_PRIVATE_KEY", required(source, "DEPLOYER_PRIVATE_KEY")],
  ["PONS_RPC_URL", rpcUrl],
  ["EXECUTION_WETH_ADDRESS", "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"],
  ["EXECUTION_USDG_ADDRESS", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
]);
const temporaryPath = `${targetPath}.local`;
await writeFile(temporaryPath, replaceValues(targetContent, updates), {
  mode: 0o600,
});
await rename(temporaryPath, targetPath);
await chmod(targetPath, 0o600);
console.log(
  "Mainnet local configuration prepared; secret values were not printed",
);
console.log("RPC and WebSocket chain validation passed for chain 4663");
console.log(
  "Governance multisig and timelock values remain owner-supplied release gates",
);
