import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  LaunchpadDomainService,
  launchpadDomainMessage,
  type LaunchpadDomainRecord,
  type LaunchpadDomainStore,
} from "../src/launchpad-domain-service.js";

const account = privateKeyToAccount(
  "0x2222222222222222222222222222222222222222222222222222222222222222",
);

test("domain challenge verifies TXT ownership and supports signed revocation", async () => {
  let record: LaunchpadDomainRecord | null = null;
  const store: LaunchpadDomainStore = {
    issue: async (input) => {
      record = {
        domainId: "d93f1e86-f507-4d4e-a66a-a4ce2d3e9487",
        ...input,
        status: "pending",
        verifiedAt: null,
        revokedAt: null,
      };
      return record;
    },
    domain: async () => record,
    markVerified: async (_id, verifiedAt) => {
      record = record ? { ...record, status: "verified", verifiedAt } : null;
    },
    markRevoked: async (_id, revokedAt) => {
      record = record ? { ...record, status: "revoked", verifiedAt: null, revokedAt } : null;
    },
  };
  let txtValue = "";
  const service = new LaunchpadDomainService(
    4663,
    store,
    { launchpad: async () => ({ owner: account.address, metadataHash: `0x${"a".repeat(64)}` }) },
    { resolveTxt: async () => [[txtValue]] },
  );
  const signedAt = new Date().toISOString();
  const issueSignature = await account.signMessage({ message: launchpadDomainMessage({
    action: "issue", chainId: 4663, launchpadId: "7", hostname: "launch.example.com", signedAt,
  }) });
  const issued = await service.issue({
    launchpadId: "7", hostname: "Launch.Example.com.", ownerAddress: account.address,
    signature: issueSignature, signedAt,
  });
  txtValue = issued.challenge;
  const verifySignedAt = new Date().toISOString();
  const verifySignature = await account.signMessage({ message: launchpadDomainMessage({
    action: "verify", chainId: 4663, launchpadId: "7", hostname: "launch.example.com", signedAt: verifySignedAt,
  }) });
  const verified = await service.verify({
    domainId: issued.domainId, ownerAddress: account.address,
    signature: verifySignature, signedAt: verifySignedAt,
  });
  assert.equal(verified.status, "verified");

  const revokeSignedAt = new Date().toISOString();
  const revokeSignature = await account.signMessage({ message: launchpadDomainMessage({
    action: "revoke", chainId: 4663, launchpadId: "7", hostname: "launch.example.com", signedAt: revokeSignedAt,
  }) });
  const revoked = await service.revoke({
    domainId: issued.domainId, ownerAddress: account.address,
    signature: revokeSignature, signedAt: revokeSignedAt,
  });
  assert.equal(revoked.status, "revoked");
});
