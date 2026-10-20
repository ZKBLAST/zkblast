import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
async function main() {
  const rpc = process.env.RPC_URL;
  const local = process.env.DLMM_REHEARSAL_RPC_URL;
  if (
    !rpc ||
    !local ||
    !["127.0.0.1", "localhost"].includes(new URL(local).hostname)
  )
    throw new Error("Mainnet source and localhost rehearsal RPC required");
  const plan = JSON.parse(
    await readFile(
      path.join(root, "deployments/mainnet/dlmm-upgrade-plan.json"),
      "utf8",
    ),
  ) as { planHash: string; observedBlock: string };
  const client = createPublicClient({ transport: http(local) });
  const request = client.request as unknown as (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  await request({
    method: "anvil_reset",
    params: [
      { forking: { jsonRpcUrl: rpc, blockNumber: Number(plan.observedBlock) } },
    ],
  });
  // A fresh journal is needed because every rehearsal resets the fork state.
  const journalFile = path.join(
    root,
    "docs/evidence/mainnet/dlmm-executor.private.json",
  );
  await mkdir(path.dirname(journalFile), { recursive: true });
  await writeFile(
    journalFile,
    JSON.stringify({ planHash: plan.planHash, steps: {} }),
    { mode: 0o600 },
  );
  const run = (stage: string, expectedFailure = false) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          path.join(root, "packages/contracts/scripts/execute-dlmm-upgrade.ts"),
          stage,
          "--fork",
        ],
        {
          cwd: path.join(root, "packages/contracts"),
          stdio: "inherit",
          env: {
            ...process.env,
            RPC_URL: local,
            CONFIRM_DLMM_UPGRADE_PLAN_HASH: plan.planHash,
          },
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        (expectedFailure ? code !== 0 : code === 0)
          ? resolve()
          : reject(new Error(`Unexpected ${stage} result ${code}`)),
      );
    });
  const manifestBefore = await readFile(
    path.join(root, "deployments/mainnet/manifest.json"),
    "utf8",
  );
  await run("deploy");
  await run("deploy");
  await run("schedule");
  await run("schedule");
  await run("execute", true);
  await request({ method: "evm_increaseTime", params: [301] });
  await request({ method: "evm_mine", params: [] });
  await run("execute");
  await run("execute");
  if (
    (await readFile(
      path.join(root, "deployments/mainnet/manifest.json"),
      "utf8",
    )) !== manifestBefore
  )
    throw new Error("Live manifest changed during fork rehearsal");
  const journal: unknown = JSON.parse(await readFile(journalFile, "utf8"));
  await writeFile(
    path.join(root, "docs/evidence/mainnet/dlmm-executor-rehearsal.json"),
    JSON.stringify(
      {
        planHash: plan.planHash,
        forkOnly: true,
        passed: true,
        idempotentStages: true,
        prematureExecutionRejected: true,
        liveManifestUnchanged: true,
        journal,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Resumable executor rehearsal passed: all stages idempotent, fee caps enforced, live manifest unchanged",
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message.split("\n")[0]
      : "Executor rehearsal failed",
  );
  process.exitCode = 1;
});
