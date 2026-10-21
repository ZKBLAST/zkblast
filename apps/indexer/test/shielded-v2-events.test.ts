import assert from "node:assert/strict";
import test from "node:test";
import { classifyProtocolEvent } from "../src/classifier.js";
import { privateVaultV2Abi } from "@zkblast/abi";

test("v2 note insertions have a distinct event identity without changing v1 classification", () => {
  assert.equal(classifyProtocolEvent("NoteInserted"), "commitment");
  assert.equal(classifyProtocolEvent("CommitmentDeposited"), "commitment");
  assert.ok(
    privateVaultV2Abi.some(
      (entry) => entry.type === "event" && entry.name === "NoteInserted",
    ),
  );
});
