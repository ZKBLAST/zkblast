pragma circom 2.2.3;

include "../v1/poseidon2.circom";

function launchpadClaimContextDomainV1() { return 10031000; }
function launchpadClaimCommitmentDomainV1() { return 10031001; }
function launchpadClaimNullifierDomainV1() { return 10031002; }

// Every public claim term is folded into the witness-bound context. This prevents a
// proof from being reused with another launchpad, pool, recipient, asset or limit.
template LaunchpadClaimStatementV1() {
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
    signal input secret;
    signal input nonce;

    signal output nullifier;
    signal output authorization_commitment;

    component contextA = Compression(8);
    contextA.in[0] <== launchpadClaimContextDomainV1();
    contextA.in[1] <== schema_version;
    contextA.in[2] <== action;
    contextA.in[3] <== chain_id;
    contextA.in[4] <== adapter;
    contextA.in[5] <== verifier_version;
    contextA.in[6] <== launchpad_id;
    contextA.in[7] <== pool;

    component contextB = Compression(8);
    contextB.in[0] <== contextA.out;
    contextB.in[1] <== snapshot_low;
    contextB.in[2] <== snapshot_high;
    contextB.in[3] <== recipient;
    contextB.in[4] <== asset;
    contextB.in[5] <== max_amount;
    contextB.in[6] <== deadline;
    contextB.in[7] <== secret;

    component commitment = Compression(8);
    commitment.in[0] <== launchpadClaimCommitmentDomainV1();
    commitment.in[1] <== contextB.out;
    commitment.in[2] <== nonce;
    commitment.in[3] <== 0;
    commitment.in[4] <== 0;
    commitment.in[5] <== 0;
    commitment.in[6] <== 0;
    commitment.in[7] <== 0;
    authorization_commitment <== commitment.out;

    component spent = Compression(8);
    spent.in[0] <== launchpadClaimNullifierDomainV1();
    spent.in[1] <== contextB.out;
    spent.in[2] <== nonce;
    spent.in[3] <== 0;
    spent.in[4] <== 0;
    spent.in[5] <== 0;
    spent.in[6] <== 0;
    spent.in[7] <== 0;
    nullifier <== spent.out;
}
