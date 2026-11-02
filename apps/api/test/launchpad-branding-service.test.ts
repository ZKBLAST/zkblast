import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  LaunchpadBrandingService,
  launchpadBrandingMessage,
  type LaunchpadBrandingStore,
  type StoredLaunchpadBranding,
} from "../src/launchpad-branding-service.js";
import { launchpadBrandingHash } from "@zkblast/database";

const account = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const branding = {
  schemaVersion: 1 as const,
  launchpadId: "7",
  slug: "alpha-launch",
  name: "Alpha Launch",
  description: "A safe token launch surface.",
  primaryColor: "#7cad22",
  backgroundColor: "#08080f",
  foregroundColor: "#f4f4f8",
  websiteUrl: "https://example.com",
  xUrl: "https://x.com/example",
};

test("publishes only owner-signed branding matching the onchain commitment", async () => {
  const saved: StoredLaunchpadBranding[] = [];
  const store: LaunchpadBrandingStore = {
    save: async (input) => {
      saved.push(input);
    },
    bySlug: async () => saved.at(-1) ?? null,
    slugsByLaunchpadIds: async () => new Map([["7", branding.slug]]),
  };
  const metadataHash = launchpadBrandingHash(branding);
  const signedAt = new Date().toISOString();
  const message = launchpadBrandingMessage({
    chainId: 4663,
    launchpadId: "7",
    version: 1,
    metadataHash,
    signedAt,
  });
  const signature = await account.signMessage({ message });
  const service = new LaunchpadBrandingService(4663, store, {
    launchpad: async () => ({ owner: account.address, metadataHash }),
  });
  const record = await service.publish({
    branding,
    version: 1,
    ownerAddress: account.address,
    signature,
    signedAt,
    logo: null,
    favicon: null,
  });
  assert.equal(record.metadataHash, metadataHash);
  assert.equal(saved[0]?.branding.slug, "alpha-launch");

  const mismatched = new LaunchpadBrandingService(4663, store, {
    launchpad: async () => ({
      owner: account.address,
      metadataHash: `0x${"f".repeat(64)}`,
    }),
  });
  await assert.rejects(
    mismatched.publish({
      branding,
      version: 1,
      ownerAddress: account.address,
      signature,
      signedAt,
      logo: null,
      favicon: null,
    }),
    /COMMITMENT_MISMATCH/u,
  );
});
