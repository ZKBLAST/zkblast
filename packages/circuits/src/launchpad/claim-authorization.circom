pragma circom 2.2.3;

include "claim-authorization-statement.circom";
include "../v1/constraints.circom";

template LaunchpadClaimAuthorizationV1() {
    signal input schema_version;
    signal input action;
    signal input chain_id;
    signal input adapter;
    signal input verifier_version;
    signal input launchpad_id;
    signal input pool;
    signal input snapshot_low;
    signal input snapshot_high;
    signal input recipient;
    signal input asset;
    signal input max_amount;
    signal input deadline;
    signal input nullifier;
    signal input authorization_commitment;

    signal input secret;
    signal input nonce;

    schema_version === 1;
    action === 1;
    verifier_version === 1;

    component chainBits = BitsV1(64);
    component adapterBits = BitsV1(160);
    component launchpadBits = BitsV1(128);
    component poolBits = BitsV1(160);
    component snapshotLowBits = BitsV1(128);
    component snapshotHighBits = BitsV1(128);
    component recipientBits = BitsV1(160);
    component assetBits = BitsV1(160);
    component amountBits = BitsV1(128);
    component deadlineBits = BitsV1(64);
    component nonceBits = BitsV1(128);
    chainBits.in <== chain_id;
    adapterBits.in <== adapter;
    launchpadBits.in <== launchpad_id;
    poolBits.in <== pool;
    snapshotLowBits.in <== snapshot_low;
    snapshotHighBits.in <== snapshot_high;
    recipientBits.in <== recipient;
    assetBits.in <== asset;
    amountBits.in <== max_amount;
    deadlineBits.in <== deadline;
    nonceBits.in <== nonce;

    component statement = LaunchpadClaimStatementV1();
    statement.schema_version <== schema_version;
    statement.action <== action;
    statement.chain_id <== chain_id;
    statement.adapter <== adapter;
    statement.verifier_version <== verifier_version;
    statement.launchpad_id <== launchpad_id;
    statement.pool <== pool;
    statement.snapshot_low <== snapshot_low;
    statement.snapshot_high <== snapshot_high;
    statement.recipient <== recipient;
    statement.asset <== asset;
    statement.max_amount <== max_amount;
    statement.deadline <== deadline;
    statement.secret <== secret;
    statement.nonce <== nonce;
    statement.authorization_commitment === authorization_commitment;
    statement.nullifier === nullifier;
}

component main { public [
    schema_version, action, chain_id, adapter, verifier_version, launchpad_id,
    pool, snapshot_low, snapshot_high, recipient, asset, max_amount, deadline,
    nullifier, authorization_commitment
] } = LaunchpadClaimAuthorizationV1();
