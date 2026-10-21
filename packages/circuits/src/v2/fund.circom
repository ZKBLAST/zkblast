pragma circom 2.2.3;
include "note.circom";

// Separate v2 token deposit (operation=0) / withdrawal (operation=1) circuit.
// No v1 key, note format or vault is accepted by this entrypoint.
template FundV2(depth) {
    signal input schema_version;
    signal input operation;
    signal input chain_id;
    signal input settlement;
    signal input tree_version;
    signal input merkle_root;
    signal input nullifier;
    signal input asset;
    signal input amount;
    signal input recipient;
    signal input commitment;

    signal input secret;
    signal input nonce;
    signal input leaf_index;
    signal input path_siblings[depth];
    signal input path_directions[depth];

    schema_version === 2;
    operation * (operation - 1) === 0;
    component note = NoteV2();
    note.chain_id <== chain_id;
    note.settlement <== settlement;
    note.tree_version <== tree_version;
    note.resource_kind <== 0;
    note.resource_address <== asset;
    note.pool_model <== 0;
    note.bin_index <== 1 << 23;
    note.amount <== amount;
    note.secret <== secret;
    note.nonce <== nonce;

    component recipientBits = BitsV1(160);
    recipientBits.in <== recipient;
    component recipientZero = IsZeroV1();
    recipientZero.in <== recipient;
    operation * recipientZero.out === 0;
    (1 - operation) * recipient === 0;
    commitment === (1 - operation) * note.commitment;
    nullifier === operation * note.nullifier;
    (1 - operation) * merkle_root === 0;

    component index = BitsV1(depth);
    index.in <== leaf_index;
    component path = MerkleRootV2(depth);
    path.leaf <== note.commitment;
    path.siblings <== path_siblings;
    path.directions <== path_directions;
    (path.out - merkle_root) * operation === 0;
    for (var level = 0; level < depth; level++) {
        path_directions[level] === index.bits[level];
    }
}

component main { public [
    schema_version, operation, chain_id, settlement, tree_version, merkle_root,
    nullifier, asset, amount, recipient, commitment
] } = FundV2(32);
