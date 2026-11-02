import assert from "node:assert/strict";
import test from "node:test";
import { launchpadMetadataCommitment } from "../src/lib/launchpad-builder-crypto";

test("builder commitment matches the canonical branding payload with assets", async () => {
  assert.equal(
    await launchpadMetadataCommitment({
      slug: "alpha-launch",
      name: "Alpha Launch",
      description: "A permissionless token launch surface.",
      primaryColor: "#7cad22",
      backgroundColor: "#08080f",
      foregroundColor: "#f4f4f8",
      websiteUrl: "https://example.com",
      xUrl: "https://x.com/example",
      logoSha256: "a".repeat(64),
      faviconSha256: "b".repeat(64),
    }),
    "0x06cbced666d8a47ed1d96d2b548055c7ccad29d070138b6d72f8bb69671c75a2",
  );
});
