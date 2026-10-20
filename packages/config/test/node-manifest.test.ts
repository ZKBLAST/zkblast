import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadDeploymentManifestFile } from "../src/node.js";
import { parseDeploymentManifest } from "../src/deployment.js";

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

test("mainnet shielded configuration rejects an unpinned or testnet prover", async () => {
  const manifest = await loadDeploymentManifestFile(testnetManifest);
  assert.ok(manifest.shielded);
  const mainnet = { ...manifest, environment: "mainnet", chainId: 4663 };
  assert.throws(
    () => parseDeploymentManifest(mainnet),
    /mainnet-specific prover release/u,
  );
  assert.throws(() =>
    parseDeploymentManifest({
      ...mainnet,
      shielded: {
        ...manifest.shielded,
        proverRelease: {
          manifestPath: "/zk/testnet/withdraw.json",
          manifestSha256: "a".repeat(64),
        },
      },
    }),
  );
});

test("core-only mainnet configuration remains valid without shielded custody", async () => {
  const manifest = await loadDeploymentManifestFile(testnetManifest);
  const parsed = parseDeploymentManifest({
    ...manifest,
    environment: "mainnet",
    chainId: 4663,
    shielded: undefined,
  });
  assert.equal(parsed.shielded, undefined);
});
