export type KeeperJob = Readonly<{ name: string; enabled: boolean }>;
export {
  LiquidationCoordinator,
  type LiquidationAttempt,
  type LiquidationCandidate,
  type LiquidationCoordinatorOptions,
} from "./perps-liquidation.js";
export { PerpsRelayerWorker, type PerpsRelayChain } from "./perps-relayer.js";
export { startPerpsRelayerFromEnv } from "./perps-relayer-runner.js";
export {
  AssistanceFundKeeper,
  type AssistanceKeeperPort,
} from "./assistance-fund-keeper.js";
export { startAssistanceFundKeeperFromEnv } from "./assistance-fund-runner.js";

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
  let stopAssistanceFund: (() => Promise<void>) | undefined;
  if (process.env.PERPS_RELAYER_ENABLED === "true") {
    void import("./perps-relayer-runner.js")
      .then(({ startPerpsRelayerFromEnv }) => startPerpsRelayerFromEnv())
      .then((stop) => { stopRelayer = stop; })
      .catch((error: unknown) => {
        const errorCode =
          error instanceof Error && /^[A-Z_]{4,80}$/u.test(error.message)
            ? error.message
            : error instanceof Error
              ? error.name
              : "PERPS_RELAYER_START_FAILED";
        console.error(JSON.stringify({
          service: "keeper",
          component: "perps-relayer",
          status: "error",
          error: errorCode,
        }));
        process.exitCode = 1;
      });
  }
  if (process.env.ASSISTANCE_FUND_KEEPER_ENABLED === "true") {
    void import("./assistance-fund-runner.js")
      .then(({ startAssistanceFundKeeperFromEnv }) => startAssistanceFundKeeperFromEnv())
      .then((stop) => { stopAssistanceFund = stop; })
      .catch((error: unknown) => {
        const errorCode = error instanceof Error ? error.message : "ASSISTANCE_FUND_KEEPER_START_FAILED";
        console.error(JSON.stringify({
          service: "keeper",
          component: "assistance-fund",
          status: "error",
          error: errorCode,
        }));
        process.exitCode = 1;
      });
  }
  const heartbeat = setInterval(() => {
    // Keep alive heartbeat
  }, 60_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    void Promise.all([stopRelayer?.(), stopAssistanceFund?.()]).finally(() => process.exit(0));
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
