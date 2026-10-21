pragma circom 2.2.3;
include "note.circom";

// Ownership/membership primitive only. Not a complete settlement circuit:
// adapters must still bind receipts, output notes and per-resource conservation.
template SpendAuthorizationV2(depth) {
    signal input schema_version;
    signal input chain_id;
    signal input settlement;
    signal input tree_version;
    signal input merkle_root;
    signal input nullifier;
    signal input action;
    signal input terms_low;
    signal input terms_high;
    signal input deadline;
    signal input authorization;

    signal input resource_kind;
    signal input resource_address;
    signal input pool_model;
    signal input bin_index;
    signal input amount;
    signal input secret;
    signal input nonce;
    signal input leaf_index;
    signal input path_siblings[depth];
    signal input path_directions[depth];

    schema_version === 2;
    component note = NoteV2();
    note.chain_id <== chain_id;
    note.settlement <== settlement;
    note.tree_version <== tree_version;
    note.resource_kind <== resource_kind;
    note.resource_address <== resource_address;
    note.pool_model <== pool_model;
    note.bin_index <== bin_index;
    note.amount <== amount;
    note.secret <== secret;
    note.nonce <== nonce;
    note.nullifier === nullifier;

    component index = BitsV1(depth);
    index.in <== leaf_index;
    component path = MerkleRootV2(depth);
    path.leaf <== note.commitment;
    path.siblings <== path_siblings;
    path.directions <== path_directions;
    path.out === merkle_root;
    for (var level = 0; level < depth; level++) {
        path_directions[level] === index.bits[level];
    }

    component allowedActions[3];
    for (var i = 0; i < 3; i++) {
        allowedActions[i] = IsZeroV1();
        allowedActions[i].in <== action - (i + 2);
    }
    allowedActions[0].out + allowedActions[1].out + allowedActions[2].out === 1;
    component low = BitsV1(128);
    component high = BitsV1(128);
    component expiry = BitsV1(64);
    low.in <== terms_low;
    high.in <== terms_high;
    expiry.in <== deadline;

    component binding = Compression(8);
    binding.in[0] <== authorizationDomainV2();
    binding.in[1] <== note.commitment;
    binding.in[2] <== nullifier;
    binding.in[3] <== action;
    binding.in[4] <== terms_low;
    binding.in[5] <== terms_high;
    binding.in[6] <== deadline;
    binding.in[7] <== secret;
    binding.out === authorization;
}

