import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  IdentityService,
  type IdentityStore,
} from "../src/identity-service.js";

const sessionToken = "a".repeat(43);
const sessionUserId = "34e3e086-a401-44a5-bdd7-8d3e14b58a46";

class MemoryIdentityStore implements IdentityStore {
  public revoked = false;
  public requestedUserIds: string[] = [];

  public async resolveSession() {
    return this.revoked
      ? null
      : {
          userId: sessionUserId,
          walletId: "8eb352ae-0d1f-4b2a-905a-8ad69da6dbcf",
        };
  }

  public async revokeSession(): Promise<void> {
    this.revoked = true;
  }

  public async getProfile(userId: string) {
    this.requestedUserIds.push(userId);
    return { id: userId, username: null, wallets: [] };
  }

  public async updateUsername(userId: string, username: string) {
    this.requestedUserIds.push(userId);
    return { username };
  }

  public async getTradeHistory(userId: string) {
    this.requestedUserIds.push(userId);
    return [];
  }
}

function setup() {
  const store = new MemoryIdentityStore();
  const identityService = new IdentityService(store);
  const app = createApp(
    {
      environment: "testnet",
      chainId: 46_630,
      chainName: "Test Chain",
      explorerUrl: "https://explorer.example",
      webOrigin: "http://127.0.0.1:3000",
    },
    { identityService },
  );
  return { app, store };
}

void test("rejects profile access without a session cookie", async () => {
  const { app } = setup();
  const response = await request(app).get("/v1/me");
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "AUTHENTICATION_FAILED");
});

void test("uses the session identity for profile, username, and trades", async () => {
  const { app, store } = setup();
  const cookie = `zkblast_session=${sessionToken}`;

  const profile = await request(app).get("/v1/me").set("cookie", cookie);
  const username = await request(app)
    .patch("/v1/me/username")
    .set("cookie", cookie)
    .send({ username: "zkblast_user" });
  const trades = await request(app)
    .get("/v1/me/trades?limit=25")
    .set("cookie", cookie);

  assert.equal(profile.status, 200);
  assert.equal(username.status, 200);
  assert.equal(trades.status, 200);
  assert.deepEqual(store.requestedUserIds, [
    sessionUserId,
    sessionUserId,
    sessionUserId,
  ]);
});

void test("logout revokes the server session and clears the cookie", async () => {
  const { app, store } = setup();
  const response = await request(app)
    .post("/v1/auth/logout")
    .set("cookie", `zkblast_session=${sessionToken}`);

  assert.equal(response.status, 204);
  assert.equal(store.revoked, true);
  assert.match(response.headers["set-cookie"]?.[0] ?? "", /Max-Age=0/u);
});
