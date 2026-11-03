import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deploymentManifestSchema } from "@zkblast/config";
import { publicContractDirectory } from "../src/public-contract-directory.js";

void test("HyperEVM contract directory includes core, DBC and launchpad deployments", async () => {
  const path = new URL(
    "../../../deployments/hyperevm-mainnet/manifest.json",
    import.meta.url,
  );
  const manifest = deploymentManifestSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  const contracts = publicContractDirectory(manifest);

  assert.equal(contracts.length, 23);
  assert.ok(contracts.some((item) => item.name === "PoolRegistry"));
  assert.ok(contracts.some((item) => item.name === "DBC · Launch Factory"));
  assert.ok(contracts.some((item) => item.name === "Launchpad · Registry"));
  assert.ok(
    contracts.every(
      (item) =>
        item.address === item.proxyAddress ||
        item.address === item.implementationAddress,
    ),
  );
});
