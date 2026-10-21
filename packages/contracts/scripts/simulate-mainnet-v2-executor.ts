import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { startPrivateForkRelay } from "./private-v2-fork-relay.js";

// Upstream rejects mutations. Only local Anvil receives signed calls.
async function main() {
  if (!process.env.RPC_URL) throw new Error("RPC_REQUIRED");
  const remote = createPublicClient({
    transport: http(process.env.RPC_URL, { retryCount: 0 }),
  });
  const block = await remote.getBlockNumber();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const relay = await startPrivateForkRelay(process.env.RPC_URL);
  const localUrl = `http://127.0.0.1:${port}`;
  const anvil = spawn(
    path.join(homedir(), ".foundry/bin/anvil"),
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "4663",
      "--silent",
      "--fork-url",
      relay.url,
      "--fork-block-number",
      String(block),
      "--no-fork-node-info",
      "--no-storage-caching",
      "--fork-state-by-number",
      "--gas-price",
      // Do not let Anvil's Ethereum priority-fee floor replace the L2 quote.
      "20324000",
      "--disable-min-priority-fee",
      "--base-fee",
      "0",
      "--block-time",
      "1",
    ],
    { stdio: "ignore", env: { PATH: process.env.PATH } },
  );
  const local = createPublicClient({
    transport: http(localUrl, { retryCount: 0 }),
  });
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        ready = (await local.request({ method: "web3_clientVersion" }))
          .toLowerCase()
          .includes("anvil");
      } catch {
        /* Local startup only. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("LOCAL_ANVIL_UNAVAILABLE");
    console.log(
      `EXECUTOR_FORK_ONLY block ${block}; live broadcast disabled by read-only relay`,
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(import.meta.dirname, "broadcast-mainnet-private-v2.ts"),
        "--simulate-local",
      ],
      { env: { ...process.env, RPC_URL: localUrl }, stdio: "inherit" },
    );
    const code = await new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    if (code !== 0) throw new Error("EXECUTOR_FORK_FAILED");
  } finally {
    anvil.kill("SIGTERM");
    await relay.close();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "FORK_SIMULATION_FAILURE",
  );
  process.exitCode = 1;
});
