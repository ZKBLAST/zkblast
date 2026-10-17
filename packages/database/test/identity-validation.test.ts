import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeWalletAddress,
  validateUsername,
} from "../src/identity-validation.js";

void test("normalizes a valid wallet address", () => {
  assert.equal(
    normalizeWalletAddress(" 0xAABBccDDeeFF0011223344556677889900aAbBcC "),
    "0xaabbccddeeff0011223344556677889900aabbcc",
  );
});

void test("rejects an invalid wallet address", () => {
  assert.throws(() => normalizeWalletAddress("0x1234"), {
    message: "INVALID_WALLET_ADDRESS",
  });
});

void test("accepts readable usernames and rejects unsafe values", () => {
  assert.equal(validateUsername(" zkblast_user "), "zkblast_user");
  assert.throws(() => validateUsername("invalid user"), {
    message: "INVALID_USERNAME",
  });
});
