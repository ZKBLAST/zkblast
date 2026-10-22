export type KeeperJob = Readonly<{ name: string; enabled: boolean }>;

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

  const heartbeat = setInterval(() => {
    // Keep alive heartbeat
  }, 60_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    process.exit(0);
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
