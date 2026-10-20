import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchProverManifest,
  validateProverManifest,
  sha256Hex,
} from "../src/shielded-prover.js";

const network = { environment: "testnet", chainId: 46630 } as const;
const asset = { path: "/zk/testnet/withdraw.wasm", sha256: "a".repeat(64) };
const manifest = {
  ...network,
  schemaVersion: 1,
  circuitVersion: 1,
  publicInputs: 13,
  trustModel: "testnet-only",
  assets: { wasm: asset, zkey: asset, verificationKey: asset },
};

test("accepts matching testnet release and rejects network, trust and asset substitution", () => {
  assert.equal(validateProverManifest(manifest, network).chainId, 46630);
  assert.throws(() =>
    validateProverManifest(manifest, { environment: "mainnet", chainId: 4663 }),
  );
  assert.throws(() =>
    validateProverManifest(manifest, { ...network, chainId: 4663 }),
  );
  assert.throws(() =>
    validateProverManifest(
      { ...manifest, trustModel: "independent-ceremony-reviewed" },
      network,
    ),
  );
  for (const path of [
    "https://example.com/a.wasm",
    "/zk/mainnet/a.wasm",
    "/zk/testnet/../a.wasm",
    "/zk/testnet/a.wasm?x=1",
  ]) {
    assert.throws(() =>
      validateProverManifest(
        {
          ...manifest,
          assets: { ...manifest.assets, wasm: { ...asset, path } },
        },
        network,
      ),
    );
  }
  assert.throws(() =>
    validateProverManifest({ ...manifest, publicInputs: 12 }, network),
  );
  assert.throws(() =>
    validateProverManifest({ ...manifest, assets: {} }, network),
  );
});

test("mainnet schema requires isolated assets and independent trust metadata, not testnet fallback", () => {
  const mainnet = { environment: "mainnet", chainId: 4663 } as const;
  const fixture = {
    ...manifest,
    ...mainnet,
    trustModel: "independent-ceremony-reviewed",
    assets: Object.fromEntries(
      Object.entries(manifest.assets).map(([name, value]) => [
        name,
        { ...value, path: value.path.replace("/testnet/", "/mainnet/") },
      ]),
    ),
  };
  assert.equal(validateProverManifest(fixture, mainnet).environment, "mainnet");
  assert.throws(() =>
    validateProverManifest({ ...fixture, trustModel: "testnet-only" }, mainnet),
  );
  assert.throws(() =>
    validateProverManifest({ ...fixture, assets: manifest.assets }, mainnet),
  );
});

test("pinned manifest rejects tampering and cross-network paths before use", async () => {
  const original = globalThis.fetch;
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const digest = await sha256Hex(bytes.buffer);
  globalThis.fetch = async () => new Response(bytes);
  try {
    const release = {
      manifestPath: "/zk/testnet/withdraw-manifest.json",
      manifestSha256: digest,
    };
    assert.equal((await fetchProverManifest(network, release)).chainId, 46630);
    await assert.rejects(
      fetchProverManifest(network, {
        ...release,
        manifestSha256: "0".repeat(64),
      }),
      /INTEGRITY/u,
    );
    await assert.rejects(
      fetchProverManifest(network, {
        ...release,
        manifestPath: "/zk/mainnet/withdraw-manifest.json",
      }),
      /UNAVAILABLE/u,
    );
    globalThis.fetch = async () => new Response(null, { status: 404 });
    await assert.rejects(fetchProverManifest(network, release), /UNAVAILABLE/u);
  } finally {
    globalThis.fetch = original;
  }
});

test("experimental mainnet requires explicit matching runtime opt-in and never accepts testnet assets", () => {
  const mainnet = { environment: "mainnet", chainId: 4663 } as const;
  const beta = {
    ...mainnet,
    proverTrustModel: "experimental-single-operator",
  } as const;
  const fixture = {
    ...manifest,
    ...mainnet,
    trustModel: "experimental-single-operator",
    assets: Object.fromEntries(
      Object.entries(manifest.assets).map(([name, value]) => [
        name,
        { ...value, path: value.path.replace("/testnet/", "/mainnet/") },
      ]),
    ),
  };
  assert.throws(() => validateProverManifest(fixture, mainnet));
  assert.equal(
    validateProverManifest(fixture, beta).trustModel,
    "experimental-single-operator",
  );
  assert.throws(() =>
    validateProverManifest(
      { ...fixture, trustModel: "independent-ceremony-reviewed" },
      beta,
    ),
  );
  assert.throws(() =>
    validateProverManifest({ ...fixture, assets: manifest.assets }, beta),
  );
});
