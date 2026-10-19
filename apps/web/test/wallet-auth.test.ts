import assert from "node:assert/strict";
import { test } from "node:test";
import { createWalletVerifyPayload } from "../src/lib/wallet-auth.js";

test("verify payload excludes challenge response metadata", () => {
  const payload = createWalletVerifyPayload(
    {
      challengeId: "challenge-id",
      message: "message to sign",
      expiresAt: "2026-10-19T04:30:00.000Z",
    },
    "0x1111111111111111111111111111111111111111",
    "0xsignature",
  );

  assert.deepEqual(payload, {
    challengeId: "challenge-id",
    walletAddress: "0x1111111111111111111111111111111111111111",
    message: "message to sign",
    signature: "0xsignature",
  });
  assert.equal("expiresAt" in payload, false);
});
