import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("[backend] Starting ZKBLAST API and Indexer...");

const api = spawn("node", ["dist/index.js"], {
  cwd: path.join(root, "apps/api"),
  stdio: "inherit",
  env: process.env,
});

const indexer = spawn("node", ["dist/runner.js"], {
  cwd: path.join(root, "apps/indexer"),
  stdio: "inherit",
  env: process.env,
});

function shutdown(signal) {
  console.log(`[backend] Received ${signal}, shutting down services...`);
  api.kill(signal);
  indexer.kill(signal);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

api.on("exit", (code) => {
  console.error(`[backend] API exited with code ${code}`);
  if (code !== 0) process.exit(code ?? 1);
});

indexer.on("exit", (code) => {
  console.error(`[backend] Indexer exited with code ${code}`);
  if (code !== 0) process.exit(code ?? 1);
});
