import { readFile, writeFile } from "node:fs/promises";

const envPath = process.argv[2] ?? ".env.testnet";
const content = await readFile(envPath, "utf8");
const lines = content.split(/\r?\n/u);
const rpcLine = lines.find((line) => line.startsWith("RPC_URL="));

if (!rpcLine) throw new Error(`${envPath}: RPC_URL is missing`);

const rpcUrl = new URL(rpcLine.slice("RPC_URL=".length));
if (!rpcUrl.hostname.endsWith(".alchemy.com")) {
  throw new Error(`${envPath}: RPC_URL is not an Alchemy endpoint`);
}

if (rpcUrl.protocol !== "https:") {
  throw new Error(`${envPath}: Alchemy RPC_URL must use HTTPS`);
}

rpcUrl.protocol = "wss:";
const wsLineIndex = lines.findIndex((line) => line.startsWith("WS_RPC_URL="));
if (wsLineIndex < 0) throw new Error(`${envPath}: WS_RPC_URL is missing`);

lines[wsLineIndex] = `WS_RPC_URL=${rpcUrl.toString()}`;
await writeFile(envPath, lines.join("\n"), { mode: 0o600 });

console.log(`${envPath}: Alchemy WebSocket RPC synchronized`);
