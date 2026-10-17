import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app.js";
import {
  AuthService,
  type AuthStore,
  type LoginChallenge,
} from "../src/auth-service.js";

class MemoryAuthStore implements AuthStore {
  private challenge: LoginChallenge | undefined;

  public async createChallenge(challenge: LoginChallenge): Promise<void> {
    this.challenge = challenge;
  }

  public async consumeChallenge(input: {
    challengeId: string;
    walletAddress: string;
    nonceHash: string;
    messageHash: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }) {
    assert.equal(input.challengeId, this.challenge?.id);
    assert.equal(input.walletAddress, this.challenge?.walletAddress);
    assert.equal(input.nonceHash, this.challenge?.nonceHash);
    assert.equal(input.messageHash, this.challenge?.messageHash);
    assert.match(input.sessionTokenHash, /^[a-f0-9]{64}$/u);
    assert.ok(input.sessionExpiresAt > new Date());
    return {
      userId: "34e3e086-a401-44a5-bdd7-8d3e14b58a46",
      walletId: "8eb352ae-0d1f-4b2a-905a-8ad69da6dbcf",
    };
  }
}

void test("wallet signature creates a secure server session", async () => {
  const account = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  );
  const authService = new AuthService(new MemoryAuthStore(), {
    chainId: 46_630,
    domain: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
  });
  const app = createApp(
    {
      environment: "testnet",
      chainId: 46_630,
      chainName: "Test Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "http://127.0.0.1:3000",
    },
    { authService },
  );

  const challenge = await request(app)
    .post("/v1/auth/challenge")
    .send({ walletAddress: account.address });
  assert.equal(challenge.status, 201);

  const signature = await account.signMessage({
    message: challenge.body.message as string,
  });
  const verified = await request(app).post("/v1/auth/verify").send({
    challengeId: challenge.body.challengeId,
    walletAddress: account.address,
    message: challenge.body.message,
    signature,
  });

  assert.equal(verified.status, 200);
  assert.equal(verified.body.userId, "34e3e086-a401-44a5-bdd7-8d3e14b58a46");
  assert.match(verified.headers["set-cookie"]?.[0] ?? "", /HttpOnly/u);
  assert.match(verified.headers["set-cookie"]?.[0] ?? "", /Secure/u);
  assert.match(verified.headers["set-cookie"]?.[0] ?? "", /SameSite=Strict/u);
  assert.doesNotMatch(JSON.stringify(verified.body), /sessionToken/u);
});
