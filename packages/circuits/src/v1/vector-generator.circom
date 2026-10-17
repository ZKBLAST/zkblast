pragma circom 2.2.3;

include "poseidon2.circom";

template VectorGeneratorV1() {
    signal input chain_id;
    signal input vault_address;
    signal input asset_address;
    signal input amount;
    signal input secret;
    signal input nonce;
    signal input path_siblings[32];
    signal input path_directions[32];
    signal output commitment;
    signal output merkle_root;
    signal output nullifier;

    component note = NoteCommitmentV1();
    note.chainId <== chain_id;
    note.vault <== vault_address;
    note.asset <== asset_address;
    note.amount <== amount;
    note.secret <== secret;
    note.nonce <== nonce;
    commitment <== note.out;

    component path = MerkleRootV1(32);
    path.leaf <== note.out;
    path.siblings <== path_siblings;
    path.directions <== path_directions;
    merkle_root <== path.out;

    component spent = NullifierV1();
    spent.chainId <== chain_id;
    spent.vault <== vault_address;
    spent.secret <== secret;
    spent.nonce <== nonce;
    nullifier <== spent.out;
}

component main = VectorGeneratorV1();
