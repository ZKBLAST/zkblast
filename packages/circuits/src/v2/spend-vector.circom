pragma circom 2.2.3;
include "note.circom";

// Local vector generation only; no verifier or setup may use this entrypoint.
template SpendVectorV2(depth) {
    signal input chain_id;
    signal input settlement;
    signal input tree_version;
    signal input resource_kind;
    signal input resource_address;
    signal input pool_model;
    signal input bin_index;
    signal input amount;
    signal input secret;
    signal input nonce;
    signal input action;
    signal input terms_low;
    signal input terms_high;
    signal input deadline;
    signal input path_siblings[depth];
    signal input path_directions[depth];
    signal output commitment;
    signal output merkle_root;
    signal output nullifier;
    signal output authorization;

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
    commitment <== note.commitment;
    nullifier <== note.nullifier;

    component path = MerkleRootV2(depth);
    path.leaf <== note.commitment;
    path.siblings <== path_siblings;
    path.directions <== path_directions;
    merkle_root <== path.out;

    component binding = Compression(8);
    binding.in[0] <== authorizationDomainV2();
    binding.in[1] <== note.commitment;
    binding.in[2] <== note.nullifier;
    binding.in[3] <== action;
    binding.in[4] <== terms_low;
    binding.in[5] <== terms_high;
    binding.in[6] <== deadline;
    binding.in[7] <== secret;
    authorization <== binding.out;
}

component main = SpendVectorV2(32);
