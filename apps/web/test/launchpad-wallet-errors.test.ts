import assert from "node:assert/strict";
import test from "node:test";
import { launchpadWalletError } from "../src/lib/launchpad-wallet-errors.js";

test("wallet rejection preserves the launchpad form and stays retryable",()=>{
  assert.equal(launchpadWalletError({ code:4001,message:"User rejected the request" },"failed"),"Request cancelled in the wallet. Your form is unchanged.");
  assert.equal(launchpadWalletError({ data:{ originalError:{ code:4001,message:"User denied" } } },"failed"),"Request cancelled in the wallet. Your form is unchanged.");
});
test("known owner/domain failures are actionable without leaking provider internals",()=>{
  assert.match(launchpadWalletError(new Error("LAUNCHPAD_OWNER_SIGNATURE_INVALID"),"failed"),/owner wallet/iu);
  assert.match(launchpadWalletError(new Error("LAUNCHPAD_DOMAIN_CHALLENGE_EXPIRED"),"failed"),/new challenge/iu);
  assert.equal(launchpadWalletError({ message:"provider stack with secret internals" },"Launchpad action failed"),"Launchpad action failed");
});
