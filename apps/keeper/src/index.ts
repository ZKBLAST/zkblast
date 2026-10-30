export type KeeperJob = Readonly<{ name: string; enabled: boolean }>;
export {
  LiquidationCoordinator,
  type LiquidationAttempt,
  type LiquidationCandidate,
  type LiquidationCoordinatorOptions,
} from "./perps-liquidation.js";
export { PerpsRelayerWorker, type PerpsRelayChain } from "./perps-relayer.js";
export { startPerpsRelayerFromEnv } from "./perps-relayer-runner.js";

export function enabledJobs(jobs: readonly KeeperJob[]): readonly KeeperJob[] {
  return jobs.filter((job) => job.enabled);
}

// Standalone service runner
const isMain = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isMain) {
  console.log(
    JSON.stringify({
      service: "keeper",
      status: "ready",
      message: "ZKBLAST Keeper operational service running.",
      timestamp: new Date().toISOString(),
    }),
  );

  let stopRelayer: (() => Promise<void>) | undefined;
  if (process.env.PERPS_RELAYER_ENABLED === "true") {
    void import("./perps-relayer-runner.js")
      .then(({ startPerpsRelayerFromEnv }) => startPerpsRelayerFromEnv())
      .then((stop) => { stopRelayer = stop; })
      .catch(() => { process.exitCode = 1; });
  }
  const heartbeat = setInterval(() => {
    // Keep alive heartbeat
  }, 60_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    void stopRelayer?.().finally(() => process.exit(0));
    if (!stopRelayer) process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
