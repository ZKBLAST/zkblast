import assert from "node:assert/strict";
import test from "node:test";
import {
  shieldedSetupAcknowledgement,
} from "../src/lib/shielded-risk-copy";

test("user-facing Shielded copy preserves material risks without release-stage labels", () => {
  assert.match(shieldedSetupAcknowledgement, /single party|one operator/u);
  assert.match(shieldedSetupAcknowledgement, /independent audit/u);
  assert.match(shieldedSetupAcknowledgement, /setup ceremony/u);
  assert.match(shieldedSetupAcknowledgement, /funds may be lost/u);
  assert.doesNotMatch(shieldedSetupAcknowledgement, /experimental|beta|production.ready/iu);
});
