pragma circom 2.2.3;
include "note.circom";

template MerkleTestV2() {
    signal input level;
    signal input left;
    signal input right;
    signal output out;
    component hash = Compression(4);
    hash.in[0] <== merkleDomainV2();
    hash.in[1] <== level;
    hash.in[2] <== left;
    hash.in[3] <== right;
    out <== hash.out;
}
component main = MerkleTestV2();
