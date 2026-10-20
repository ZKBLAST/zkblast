import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerConfig } from "@zkblast/config";
import { loadDeploymentManifestFile } from "@zkblast/config/node";
import { getAddress } from "viem";
import { marketChartSynchronizer } from "./market-chart-sync.js";

async function main() {
  const config = loadServerConfig(process.env);
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const manifest = await loadDeploymentManifestFile(
    resolve(root, config.DEPLOYMENT_MANIFEST_PATH),
    { environment: config.APP_ENV, chainId: config.CHAIN_ID },
  );
  const jobs = marketChartSynchronizer(
    config,
    getAddress(manifest.integration.poolRegistry),
  );
  try {
    await jobs.synchronize();
  } finally {
    await jobs.close();
  }
}
main().catch(() => {
  console.error(
    "CHART_SYNC_FAILED: no credential-bearing error details are logged",
  );
  process.exitCode = 1;
});
