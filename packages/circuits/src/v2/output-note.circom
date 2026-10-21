pragma circom 2.2.3;
include "note.circom";

// Output commitment primitive. The final action circuit must compose this with
// input membership and conservation, and bind this commitment in action terms.
template OutputNoteV2() {
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
    signal input output_commitment;

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
    note.commitment === output_commitment;
}

// Testable primitive only; not a custody-authorizing verifier release.
component main { public [
    chain_id, settlement, tree_version, output_commitment
] } = OutputNoteV2();
