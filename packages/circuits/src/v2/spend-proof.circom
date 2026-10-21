pragma circom 2.2.3;
include "spend.circom";

// Standalone spend primitive, not approved for custody or settlement deployment.
component main { public [
    schema_version, chain_id, settlement, tree_version, merkle_root, nullifier,
    action, terms_low, terms_high, deadline, authorization
] } = SpendAuthorizationV2(32);
