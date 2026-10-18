import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadDeploymentManifestFile } from "../src/node.js";

const testnetManifest = fileURLToPath(
  new URL("../../../deployments/testnet/manifest.json", import.meta.url),
);

test("loads the schema-valid manifest for the exact runtime", async () => {
  const manifest = await loadDeploymentManifestFile(testnetManifest, {
    environment: "testnet",
    chainId: 46_630,
  });

  assert.equal(manifest.protocol, "ZKBLAST");
  assert.equal(manifest.environment, "testnet");
  assert.equal(manifest.chainId, 46_630);
});

test("rejects environment and chain crossover", async () => {
  await assert.rejects(
    loadDeploymentManifestFile(testnetManifest, {
      environment: "mainnet",
      chainId: 46_630,
    }),
    /environment mismatch/iu,
  );
  await assert.rejects(
    loadDeploymentManifestFile(testnetManifest, {
      environment: "testnet",
      chainId: 1,
    }),
    /chain mismatch/iu,
  );
});
