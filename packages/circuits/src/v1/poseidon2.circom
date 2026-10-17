pragma circom 2.2.3;

include "../vendor/taceo-poseidon2/poseidon2.circom";

function noteDomainV1() {
    return 20471547150951960819947918132662022695032722773090479024283843921838734342716;
}

function nullifierDomainV1() {
    return 1318319366689224528532575366923278718674633697028195300904791885933343761857;
}

function merkleDomainV1() {
    return 12549531065135229307630222961034828520083803988054572781452577856409828989647;
}

template Compression(t) {
    signal input in[t];
    signal output out;

    component permutation = Poseidon2(t);
    permutation.in <== in;
    out <== permutation.out[0] + in[0];
}

template NoteCommitmentV1() {
    signal input chainId;
    signal input vault;
    signal input asset;
    signal input amount;
    signal input secret;
    signal input nonce;
    signal output out;

    component hash = Compression(8);
    hash.in[0] <== noteDomainV1();
    hash.in[1] <== chainId;
    hash.in[2] <== vault;
    hash.in[3] <== asset;
    hash.in[4] <== amount;
    hash.in[5] <== secret;
    hash.in[6] <== nonce;
    hash.in[7] <== 0;
    out <== hash.out;
}

template NullifierV1() {
    signal input chainId;
    signal input vault;
    signal input secret;
    signal input nonce;
    signal output out;

    component hash = Compression(8);
    hash.in[0] <== nullifierDomainV1();
    hash.in[1] <== chainId;
    hash.in[2] <== vault;
    hash.in[3] <== secret;
    hash.in[4] <== nonce;
    hash.in[5] <== 0;
    hash.in[6] <== 0;
    hash.in[7] <== 0;
    out <== hash.out;
}

template MerkleNodeV1(level) {
    signal input left;
    signal input right;
    signal output out;

    component hash = Compression(4);
    hash.in[0] <== merkleDomainV1();
    hash.in[1] <== level;
    hash.in[2] <== left;
    hash.in[3] <== right;
    out <== hash.out;
}

template MerkleRootV1(depth) {
    signal input leaf;
    signal input siblings[depth];
    signal input directions[depth];
    signal output out;

    signal nodes[depth + 1];
    signal selected[depth];
    signal left[depth];
    signal right[depth];
    component hashes[depth];
    nodes[0] <== leaf;

    for (var level = 0; level < depth; level++) {
        directions[level] * (directions[level] - 1) === 0;
        selected[level] <== directions[level] * (siblings[level] - nodes[level]);
        left[level] <== nodes[level] + selected[level];
        right[level] <== siblings[level] - selected[level];
        hashes[level] = MerkleNodeV1(level);
        hashes[level].left <== left[level];
        hashes[level].right <== right[level];
        nodes[level + 1] <== hashes[level].out;
    }
    out <== nodes[depth];
}
