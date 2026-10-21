import { test } from "node:test";
import assert from "node:assert/strict";
import { provePrivateV2 } from "../browser/private-v2-prover.mjs";

function fixture() {
  const scope = {
    environment: "testnet",
    chainId: "46630",
    settlement: "0x0000000000000000000000000000000000001000",
    treeVersion: "2",
  };
  const signals = [
    "2",
    "0",
    scope.chainId,
    "4096",
    "2",
    "0",
    "0",
    "8192",
    "1",
    "0",
    "123",
  ];
  const asset = (name) => ({
    path: `/zk/testnet/v2/${name}`,
    sha256: "a".repeat(64),
  });
  const request = {
    kind: "fund",
    scope,
    input: { chain_id: scope.chainId, settlement: "4096", tree_version: "2" },
    expectedPublicInputs: signals,
    manifest: {
      ...scope,
      schemaVersion: 2,
      kind: "fund",
      publicInputs: 11,
      assets: {
        wasm: asset("fund.wasm"),
        zkey: asset("fund.zkey"),
        verificationKey: asset("fund.json"),
      },
    },
  };
  const dependencies = {
    groth16: {
      fullProve: async () => ({ proof: {}, publicSignals: signals }),
      verify: async () => true,
    },
    fetchAsset: async () =>
      new TextEncoder().encode(
        JSON.stringify({ protocol: "groth16", curve: "bn128", nPublic: 11 }),
      ).buffer,
    sha256: async () => "a".repeat(64),
    onStage: () => {},
  };
  return { request, dependencies };
}

test("v2 worker accepts verified exact public statement", async () => {
  const { request, dependencies } = fixture();
  assert.equal(
    (await provePrivateV2(request, dependencies)).publicSignals.length,
    11,
  );
});

test("v2 worker rejects wrong scope, asset hash, key arity, altered statement and invalid proof", async () => {
  for (const mutate of [
    (r) => {
      r.scope = { ...r.scope, environment: "mainnet" };
    },
    (r) => {
      r.input.settlement = "4097";
    },
    (r) => {
      r.expectedPublicInputs[0] = "1";
    },
    (r) => {
      r.manifest.assets.wasm.path = "https://example.com/remote.wasm";
    },
    (_, d) => {
      d.sha256 = async () => "b".repeat(64);
    },
    (_, d) => {
      d.fetchAsset = async () =>
        new TextEncoder().encode(
          '{"protocol":"groth16","curve":"bn128","nPublic":13}',
        ).buffer;
    },
    (_, d) => {
      d.groth16.fullProve = async () => ({
        proof: {},
        publicSignals: Array(11).fill("0"),
      });
    },
    (_, d) => {
      d.groth16.verify = async () => false;
    },
  ]) {
    const { request, dependencies } = fixture();
    mutate(request, dependencies);
    await assert.rejects(provePrivateV2(request, dependencies));
  }
});
