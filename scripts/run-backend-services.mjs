import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serviceMode = (process.env.SERVICE_MODE || "all").toLowerCase();

const processes = [];

function startProcess(name, scriptPath, cwd) {
  console.log(`[backend] Starting ${name}...`);
  const proc = spawn("node", [scriptPath], {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    env: process.env,
  });

  proc.on("exit", (code) => {
    console.error(`[backend] ${name} exited with code ${code}`);
    if (code !== 0 && code !== null) {
      process.exit(code ?? 1);
    }
  });

  processes.push({ name, proc });
  return proc;
}

const shouldRun = (name) => serviceMode === "all" || serviceMode.split(",").map(s => s.trim()).includes(name);

if (shouldRun("api")) {
  startProcess("API", "dist/index.js", "apps/api");
}

if (shouldRun("indexer")) {
  startProcess("Indexer", "dist/runner.js", "apps/indexer");
}

if (shouldRun("keeper")) {
  startProcess("Keeper", "dist/index.js", "apps/keeper");
}

function shutdown(signal) {
  console.log(`[backend] Received ${signal}, shutting down all child processes...`);
  for (const { name, proc } of processes) {
    try {
      proc.kill(signal);
    } catch (err) {
      console.error(`[backend] Error killing ${name}:`, err);
    }
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
