import assert from "node:assert/strict";
import test from "node:test";
import {
  shieldedSetupAcknowledgement,
  shieldedSetupNotice,
} from "../src/lib/shielded-risk-copy";

test("user-facing Shielded copy preserves material risks without release-stage labels", () => {
  for (const text of [shieldedSetupNotice, shieldedSetupAcknowledgement]) {
    assert.match(text, /single party|one operator/u);
    assert.match(text, /independent audit/u);
    assert.match(text, /setup ceremony/u);
    assert.match(text, /funds may be lost/u);
    assert.doesNotMatch(text, /experimental|beta|production.ready/iu);
  }
  assert.match(shieldedSetupNotice, /does not limit your total exposure/u);
});
