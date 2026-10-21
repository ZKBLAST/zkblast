import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPrivateProverV2,
  sealPrivateProverV2,
} from "../src/private-prover-v2.js";
import { sha256Hex } from "../src/shielded-prover.js";

const scope = {
  environment: "testnet" as const,
  chainId: "46630",
  settlement: "0x0000000000000000000000000000000000001000",
  treeVersion: "2",
};
const asset = (name: string) => ({
  path: `/zk/testnet/v2/${name}`,
  sha256: "a".repeat(64),
});
const assets = {
  wasm: asset("fund.wasm"),
  zkey: asset("fund.zkey"),
  verificationKey: asset("fund.json"),
};
const manifest = {
  ...scope,
  schemaVersion: 2,
  trustModel: "single-operator-testnet",
  noteCalculator: asset("note.wasm"),
  action: { kind: "action", publicInputs: 32, assets },
  fund: { kind: "fund", publicInputs: 11, assets },
};
const serialized = JSON.stringify(manifest);
const fetcher: typeof fetch = async () => new Response(serialized);

test("mainnet prover is hash-pinned and rejects testnet paths or candidate trust metadata", async () => {
  const mainnet = JSON.parse(
    JSON.stringify(manifest)
      .replaceAll("testnet", "mainnet")
      .replaceAll("46630", "4663"),
  );
  const sealed = await sealPrivateProverV2(
    mainnet,
    "/zk/mainnet/v2/release.json",
  );
  const scope = { ...mainnet, environment: "mainnet" as const };
  assert.equal(
    (
      await fetchPrivateProverV2(
        scope,
        sealed.reference,
        async () => new Response(sealed.serialized),
      )
    ).environment,
    "mainnet",
  );
  await assert.rejects(
    fetchPrivateProverV2(scope, {
      ...sealed.reference,
      manifestPath: "/zk/testnet/v2/release.json",
    }),
    /NETWORK/u,
  );
  await assert.rejects(
    sealPrivateProverV2(
      { ...mainnet, noteCalculator: asset("note.wasm") },
      "/zk/mainnet/v2/release.json",
    ),
    /NETWORK/u,
  );
  await assert.rejects(
    sealPrivateProverV2(
      { ...mainnet, trustModel: "single-operator-mainnet-candidate" },
      "/zk/mainnet/v2/release.json",
    ),
  );
});

test("sealing produces a self-consistent release reference without activating it", async () => {
  const sealed = await sealPrivateProverV2(
    manifest,
    "/zk/testnet/v2/release.json",
  );
  assert.deepEqual(
    await fetchPrivateProverV2(
      scope,
      sealed.reference,
      async () => new Response(sealed.serialized),
    ),
    sealed.manifest,
  );
});

test("v2 manifest is hash-pinned, deployment-bound and same-origin only", async () => {
  const reference = {
    manifestPath: "/zk/testnet/v2/release.json",
    manifestSha256: await sha256Hex(
      new TextEncoder().encode(serialized).buffer,
    ),
  };
  assert.deepEqual(
    await fetchPrivateProverV2(scope, reference, fetcher),
    manifest,
  );
  await assert.rejects(
    fetchPrivateProverV2(
      scope,
      { ...reference, manifestSha256: "b".repeat(64) },
      fetcher,
    ),
    /HASH/u,
  );
  await assert.rejects(
    fetchPrivateProverV2(
      { ...scope, environment: "mainnet" },
      reference,
      fetcher,
    ),
    /NETWORK/u,
  );
  await assert.rejects(
    fetchPrivateProverV2({ ...scope, treeVersion: "3" }, reference, fetcher),
    /SCOPE/u,
  );
  await assert.rejects(
    fetchPrivateProverV2(
      scope,
      { ...reference, manifestPath: "https://external.example/release.json" },
      fetcher,
    ),
  );
  await assert.rejects(
    fetchPrivateProverV2(
      scope,
      reference,
      async () =>
        new Response(serialized, { headers: { "content-length": "999999" } }),
    ),
    /TOO_LARGE/u,
  );
});
