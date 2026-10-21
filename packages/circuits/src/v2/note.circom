pragma circom 2.2.3;

include "../v1/constraints.circom";
include "../v1/poseidon2.circom";

// Reuse the hash primitive, never the v1 note/nullifier/Merkle domains.
function noteDomainV2() { return 2002001; }
function resourceDomainV2() { return 2002002; }
function nullifierDomainV2() { return 2002003; }
function merkleDomainV2() { return 2002004; }
function authorizationDomainV2() { return 2002005; }

template NoteV2() {
    signal input chain_id;
    signal input settlement;
    signal input tree_version;
    signal input resource_kind; // 0 = token, 1 = LP share
    signal input resource_address; // token contract or pool contract
    signal input pool_model; // 0 = DAMM/token, 1 = DLMM
    signal input bin_index; // signed int24 bin biased by 2^23
    signal input amount;
    signal input secret;
    signal input nonce;
    signal output commitment;
    signal output nullifier;

    component ranges[9];
    ranges[0] = BitsV1(64);
    ranges[1] = BitsV1(160);
    ranges[2] = BitsV1(64);
    ranges[3] = BitsV1(160);
    ranges[4] = BitsV1(24);
    ranges[5] = BitsV1(128);
    ranges[6] = BitsV1(248);
    ranges[7] = BitsV1(128);
    ranges[8] = BitsV1(1);
    ranges[0].in <== chain_id;
    ranges[1].in <== settlement;
    ranges[2].in <== tree_version;
    ranges[3].in <== resource_address;
    ranges[4].in <== bin_index;
    ranges[5].in <== amount;
    ranges[6].in <== secret;
    ranges[7].in <== nonce;
    ranges[8].in <== resource_kind;
    pool_model * (pool_model - 1) === 0;
    (1 - resource_kind) * pool_model === 0;
    (1 - pool_model) * (bin_index - (1 << 23)) === 0;

    component nonzero[6];
    for (var i = 0; i < 6; i++) {
        nonzero[i] = IsZeroV1();
    }
    nonzero[0].in <== chain_id;
    nonzero[1].in <== settlement;
    nonzero[2].in <== tree_version;
    nonzero[3].in <== resource_address;
    nonzero[4].in <== amount;
    nonzero[5].in <== secret;
    for (var i = 0; i < 6; i++) {
        nonzero[i].out === 0;
    }

    component resource = Compression(4);
    resource.in[0] <== resourceDomainV2();
    resource.in[1] <== resource_kind;
    resource.in[2] <== resource_address;
    resource.in[3] <== pool_model * (1 << 24) + bin_index;

    component note = Compression(8);
    note.in[0] <== noteDomainV2();
    note.in[1] <== chain_id;
    note.in[2] <== settlement;
    note.in[3] <== tree_version;
    note.in[4] <== resource.out;
    note.in[5] <== amount;
    note.in[6] <== secret;
    note.in[7] <== nonce;
    commitment <== note.out;

    // Independent of action/terms: changing swap to LP must not permit reuse.
    component spent = Compression(4);
    spent.in[0] <== nullifierDomainV2();
    spent.in[1] <== note.out;
    spent.in[2] <== secret;
    spent.in[3] <== nonce;
    nullifier <== spent.out;
}

template MerkleRootV2(depth) {
    signal input leaf;
    signal input siblings[depth];
    signal input directions[depth];
    signal output out;
    signal nodes[depth + 1];
    signal offset[depth];
    component hashes[depth];
    nodes[0] <== leaf;
    for (var level = 0; level < depth; level++) {
        directions[level] * (directions[level] - 1) === 0;
        offset[level] <== directions[level] * (siblings[level] - nodes[level]);
        hashes[level] = Compression(4);
        hashes[level].in[0] <== merkleDomainV2();
        hashes[level].in[1] <== level;
        hashes[level].in[2] <== nodes[level] + offset[level];
        hashes[level].in[3] <== siblings[level] - offset[level];
        nodes[level + 1] <== hashes[level].out;
    }
    out <== nodes[depth];
}
