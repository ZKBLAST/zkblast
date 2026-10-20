import assert from "node:assert/strict";
import test from "node:test";
import { zkBlastVaultAbi } from "@zkblast/abi";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  type Address,
  type Hex,
} from "viem";
import { executeShieldedDeposit } from "../src/lib/shielded-deposit.js";
import type { ShieldedNoteV1 } from "../src/lib/notecrypto.js";
import type { EthereumProvider } from "../src/types/application.js";

const sender = `0x${"1".repeat(40)}` as Address;
const token = `0x${"2".repeat(40)}` as Address;
const vault = `0x${"3".repeat(40)}` as Address;
const commitment = 789n;
const commitmentHex = `0x${commitment.toString(16).padStart(64, "0")}` as Hex;
const note: ShieldedNoteV1 = {
  format: "zkblast-note",
  version: 1,
  environment: "testnet",
  chainId: 46630,
  vaultAddress: vault,
  treeVersion: 1,
  assetAddress: token,
  amountRaw: "1000000",
  secret: "123",
  nonce: "456",
  commitment: commitment.toString(),
  leafIndex: null,
  transactionHash: null,
  createdAt: "2026-10-18T00:00:00.000Z",
  status: "prepared",
};

test("a previously submitted note cannot trigger another approval or deposit", async () => {
  let requests = 0;
  const provider: EthereumProvider = {
    request: async () => {
      requests++;
      return null;
    },
  };
  await assert.rejects(
    executeShieldedDeposit(
      provider,
      sender,
      { ...note, status: "unspent" },
      () => undefined,
    ),
    /NOTE_ALREADY_SUBMITTED/u,
  );
  assert.equal(requests, 0);
});

test("resets a mismatched allowance, approves exactly, and validates the deposit event", async () => {
  const hashes = [1, 2, 3].map(
    (value) => `0x${value.toString(16).padStart(64, "0")}` as Hex,
  );
  let sent = 0;
  const logs = [
    {
      address: vault,
      topics: encodeEventTopics({
        abi: zkBlastVaultAbi,
        eventName: "CommitmentDeposited",
        args: { depositor: sender, asset: token, commitment: commitmentHex },
      }),
      data: encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint32" },
          { type: "bytes32" },
          { type: "uint64" },
        ],
        [1_000_000n, 7, `0x${"a".repeat(64)}`, 1n],
      ),
    },
  ];
  const provider: EthereumProvider = {
    request: async ({ method, params }) => {
      if (method === "eth_chainId") return "0xb626";
      if (method === "eth_call")
        return encodeFunctionResult({
          abi: [
            {
              type: "function",
              name: "allowance",
              stateMutability: "view",
              inputs: [{ type: "address" }, { type: "address" }],
              outputs: [{ type: "uint256" }],
            },
          ] as const,
          functionName: "allowance",
          result: 5n,
        });
      if (method === "eth_sendTransaction") {
        sent += 1;
        return hashes[sent - 1];
      }
      if (method === "eth_getTransactionReceipt") {
        const hash = (params as string[])[0];
        return {
          transactionHash: hash,
          status: "0x1",
          logs: hash === hashes[2] ? logs : [],
        };
      }
      throw new Error(`UNEXPECTED_METHOD:${method}`);
    },
  };
  const states: string[] = [];
  const result = await executeShieldedDeposit(provider, sender, note, (state) =>
    states.push(state),
  );
  assert.equal(sent, 3);
  assert.deepEqual(states, [
    "resetting-allowance",
    "approving",
    "depositing",
    "confirmed",
  ]);
  assert.equal(result.leafIndex, 7);
  assert.equal(result.transactionHash, hashes[2]);
  assert.equal(result.status, "unspent");
});

test("rejects a receipt without the matching public commitment event", async () => {
  let sent = 0;
  const provider: EthereumProvider = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return "0xb626";
      if (method === "eth_call")
        return encodeFunctionResult({
          abi: [
            {
              type: "function",
              name: "allowance",
              stateMutability: "view",
              inputs: [{ type: "address" }, { type: "address" }],
              outputs: [{ type: "uint256" }],
            },
          ] as const,
          functionName: "allowance",
          result: 1_000_000n,
        });
      if (method === "eth_sendTransaction") {
        sent += 1;
        return `0x${"4".repeat(64)}`;
      }
      if (method === "eth_getTransactionReceipt")
        return {
          transactionHash: `0x${"4".repeat(64)}`,
          status: "0x1",
          logs: [],
        };
      return null;
    },
  };
  await assert.rejects(
    executeShieldedDeposit(provider, sender, note, () => undefined),
    /DEPOSIT_EVENT_MISSING/u,
  );
  assert.equal(sent, 1);
});
