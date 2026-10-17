pragma circom 2.2.3;

include "poseidon2.circom";
include "constraints.circom";

template WithdrawalV1() {
    signal input schema_version;
    signal input action;
    signal input chain_id;
    signal input vault_address;
    signal input tree_version;
    signal input merkle_root;
    signal input nullifier;
    signal input asset_address;
    signal input amount;
    signal input recipient_address;
    signal input relayer_address;
    signal input relayer_fee;
    signal input deadline;

    signal input secret;
    signal input nonce;
    signal input leaf_index;
    signal input path_siblings[32];
    signal input path_directions[32];

    schema_version === 1;
    action === 1;

    component chainBits = BitsV1(64);
    component vaultBits = BitsV1(160);
    component versionBits = BitsV1(64);
    component assetBits = BitsV1(160);
    component amountBits = BitsV1(128);
    component recipientBits = BitsV1(160);
    component relayerBits = BitsV1(160);
    component feeBits = BitsV1(128);
    component deadlineBits = BitsV1(64);
    component nonceBits = BitsV1(128);
    component indexBits = BitsV1(32);
    chainBits.in <== chain_id;
    vaultBits.in <== vault_address;
    versionBits.in <== tree_version;
    assetBits.in <== asset_address;
    amountBits.in <== amount;
    recipientBits.in <== recipient_address;
    relayerBits.in <== relayer_address;
    feeBits.in <== relayer_fee;
    deadlineBits.in <== deadline;
    nonceBits.in <== nonce;
    indexBits.in <== leaf_index;

    component amountIsZero = IsZeroV1();
    amountIsZero.in <== amount;
    amountIsZero.out === 0;
    component feeWithinAmount = LessEqV1(128);
    feeWithinAmount.left <== relayer_fee;
    feeWithinAmount.right <== amount;
    feeWithinAmount.out === 1;

    component commitment = NoteCommitmentV1();
    commitment.chainId <== chain_id;
    commitment.vault <== vault_address;
    commitment.asset <== asset_address;
    commitment.amount <== amount;
    commitment.secret <== secret;
    commitment.nonce <== nonce;

    component computedNullifier = NullifierV1();
    computedNullifier.chainId <== chain_id;
    computedNullifier.vault <== vault_address;
    computedNullifier.secret <== secret;
    computedNullifier.nonce <== nonce;
    computedNullifier.out === nullifier;

    component path = MerkleRootV1(32);
    path.leaf <== commitment.out;
    path.siblings <== path_siblings;
    path.directions <== path_directions;
    path.out === merkle_root;

    for (var level = 0; level < 32; level++) {
        path_directions[level] === indexBits.bits[level];
    }
}

component main { public [
    schema_version,
    action,
    chain_id,
    vault_address,
    tree_version,
    merkle_root,
    nullifier,
    asset_address,
    amount,
    recipient_address,
    relayer_address,
    relayer_fee,
    deadline
] } = WithdrawalV1();
