import assert from "node:assert/strict";
import test from "node:test";

import {
  launchpadBrandingHash,
  launchpadBrandingSchema,
  launchpadSlugSchema,
  validateLaunchpadImage,
} from "../src/launchpad-branding.js";

const branding = {
  schemaVersion: 1 as const,
  launchpadId: "7",
  slug: "alpha-launch",
  name: "Alpha Launch",
  description: "A permissionless token launch surface.",
  primaryColor: "#7cad22",
  backgroundColor: "#08080f",
  foregroundColor: "#f4f4f8",
  websiteUrl: "https://example.com",
  xUrl: "https://x.com/example",
};

test("branding is canonical, accessible and rejects unsafe values", () => {
  const parsed = launchpadBrandingSchema.parse(branding);
  assert.equal(launchpadBrandingHash(parsed), launchpadBrandingHash(parsed));
  assert.equal(
    launchpadBrandingHash(parsed),
    launchpadBrandingHash({ ...parsed, launchpadId: "8" }),
    "pre-deployment branding commitment must not predict the registry counter",
  );
  assert.equal(launchpadSlugSchema.parse("Alpha-Launch"), "alpha-launch");
  assert.throws(() => launchpadSlugSchema.parse("admin"), /Reserved/u);
  assert.throws(
    () =>
      launchpadBrandingSchema.parse({
        ...branding,
        websiteUrl: "javascript:alert(1)",
      }),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      launchpadBrandingSchema.parse({
        ...branding,
        foregroundColor: "#090910",
      }),
    /contrast/u,
  );
  assert.throws(
    () => launchpadBrandingSchema.parse({ ...branding, name: "<script>" }),
    /Unsafe/u,
  );
});

test("image validation checks signature, bytes and dimensions", () => {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  png.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(png.buffer).setUint32(16, 192);
  new DataView(png.buffer).setUint32(20, 192);
  assert.equal(validateLaunchpadImage("logo", "image/png", png).width, 192);
  assert.throws(
    () => validateLaunchpadImage("logo", "image/svg+xml", png),
    /MIME/u,
  );
  assert.throws(
    () => validateLaunchpadImage("favicon", "image/png", new Uint8Array(24)),
    /SIGNATURE/u,
  );
});
