import assert from "node:assert/strict";
import test from "node:test";
import {
  createApiCredential,
  decryptWebhookSecret,
  encryptWebhookSecret,
  validateWebhookUrl,
  verifyApiCredential,
  webhookEnvelope,
  webhookRetry,
  ApiKeyRateGuard,
} from "../src/launchpad-developer-security.js";

test("creates a display-once API credential whose stored hash verifies", () => {
    const credential = createApiCredential();

    assert.equal(credential.secret.startsWith(`${credential.prefix}.`), true);
    assert.equal(
      verifyApiCredential(credential.secret, credential.salt, credential.hash),
      true,
    );
    assert.equal(
      verifyApiCredential(
        `${credential.prefix}.wrong`,
        credential.salt,
        credential.hash,
      ),
      false,
    );
  });

test("encrypts webhook signing secrets with authenticated encryption", () => {
    const key = Buffer.alloc(32, 7);
    const encrypted = encryptWebhookSecret("secret-value", key);

    assert.equal(decryptWebhookSecret(encrypted, key), "secret-value");
    assert.throws(() => decryptWebhookSecret(encrypted, Buffer.alloc(32, 8)));
  });

test("allows public HTTPS endpoints and rejects unsafe destinations", async () => {
    const publicResolver = async () => ["203.0.113.10"] as const;

    assert.equal(
      await validateWebhookUrl("https://hooks.example.com/zkblast", publicResolver),
      "https://hooks.example.com/zkblast",
    );
    await assert.rejects(
      validateWebhookUrl("http://hooks.example.com", publicResolver),
      /LAUNCHPAD_WEBHOOK_URL_INVALID/u,
    );
    await assert.rejects(
      validateWebhookUrl("https://localhost/hook", publicResolver),
      /LAUNCHPAD_WEBHOOK_SSRF_BLOCKED/u,
    );
    await assert.rejects(
      validateWebhookUrl("https://hooks.example.com", async () => ["10.0.0.2"]),
      /LAUNCHPAD_WEBHOOK_SSRF_BLOCKED/u,
    );
  });

test("signs a replay-identifiable versioned envelope", () => {
    const event = {
      id: "evt_01",
      type: "trade.executed" as const,
      createdAt: "2026-11-02T00:00:00.000Z",
      data: { launchpadId: "1" },
    };
    const envelope = webhookEnvelope(event, "client-secret");

    assert.deepEqual(JSON.parse(envelope.body), {
      schemaVersion: 1,
      ...event,
    });
    assert.equal(envelope.headers["x-zkblast-event-id"], "evt_01");
    assert.match(
      envelope.headers["x-zkblast-signature"],
      /^v1=[0-9a-f]{64}$/u,
    );
  });

test("backs off before moving a delivery to dead letter", () => {
    assert.deepEqual(webhookRetry(0, 0), {
      status: "failed",
      nextAttemptAt: new Date(60_000),
    });
    assert.deepEqual(webhookRetry(5, 0), {
      status: "dead_letter",
      nextAttemptAt: null,
    });
  });

test("rate limits each API key independently", () => {
  const guard = new ApiKeyRateGuard(2,1_000);
  assert.equal(guard.consume("key-a",0).allowed,true);
  assert.equal(guard.consume("key-a",1).allowed,true);
  assert.equal(guard.consume("key-a",2).allowed,false);
  assert.equal(guard.consume("key-b",2).allowed,true);
  assert.equal(guard.consume("key-a",1_001).allowed,true);
});
