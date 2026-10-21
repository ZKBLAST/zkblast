import assert from "node:assert/strict";
import test from "node:test";
import type { Hex, PublicClient } from "viem";
import { ShieldedService } from "../src/shielded-service.js";

const hex = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
// Deterministic test hasher only; production service calls the deployed v2 hasher.
const hash = (level: bigint, left: Hex, right: Hex): Hex =>
  hex((BigInt(left) * 3n + BigInt(right) * 5n + level + 1n) % 2n ** 128n);

test("v2 API rebuilds its own NoteInserted tree against a block-pinned currentRoot", async () => {
  let root = hex(123n);
  let zero = hex(1n);
  for (let level = 0n; level < 32n; level += 1n) {
    root = hash(level, root, zero);
    zero = hash(level, zero, zero);
  }
  const client = {
    getBlockNumber: async () => 100n,
    readContract: async (request: {
      functionName: string;
      blockNumber?: bigint;
      args?: readonly [bigint, Hex, Hex];
    }) => {
      if (request.functionName === "currentRoot") {
        assert.equal(request.blockNumber, 100n);
        return root;
      }
      assert.equal(request.functionName, "hashMerkleNode");
      return hash(...request.args!);
    },
    getLogs: async (request: { event: { name: string }; address: string }) => {
      assert.equal(request.event.name, "NoteInserted");
      assert.equal(
        request.address,
        "0x0000000000000000000000000000000000001000",
      );
      return [
        {
          args: { leafIndex: 0, commitment: hex(123n) },
          blockNumber: 90n,
          logIndex: 0,
        },
      ];
    },
  } as unknown as PublicClient;
  const service = new ShieldedService(client, {
    schemaVersion: 2,
    vault: "0x0000000000000000000000000000000000001000",
    fieldHasher: "0x0000000000000000000000000000000000002000",
    deploymentBlock: 90n,
  });
  const path = await service.path(hex(123n));
  assert.equal(path.root, root);
  assert.equal(path.leafIndex, 0);
  assert.equal(path.siblings.length, 32);
  assert.equal(path.directions.length, 32);
  await assert.rejects(service.path(hex(124n)), /COMMITMENT_NOT_FOUND/u);
});

test("v2 API refuses a nonsequential tree before returning a path", async () => {
  const client = {
    getBlockNumber: async () => 100n,
    readContract: async () => hex(1n),
    getLogs: async () => [
      {
        args: { leafIndex: 1, commitment: hex(123n) },
        blockNumber: 90n,
        logIndex: 0,
      },
    ],
  } as unknown as PublicClient;
  const service = new ShieldedService(client, {
    schemaVersion: 2,
    vault: "0x0000000000000000000000000000000000001000",
    fieldHasher: "0x0000000000000000000000000000000000002000",
    deploymentBlock: 90n,
  });
  await assert.rejects(service.path(hex(123n)), /NON_SEQUENTIAL/u);
});
