pragma circom 2.2.3;

include "../v2/note.circom";

function perpPositionDomainV1() { return 3001001; }
function perpPositionNullifierDomainV1() { return 3001002; }
function perpOpenDomainV1() { return 3001003; }
function perpCloseDomainV1() { return 3001004; }

template PerpPositionCommitmentV1() {
    signal input chain_id;
    signal input adapter;
    signal input market_low;
    signal input market_high;
    signal input is_long;
    signal input margin;
    signal input leverage_bps;
    signal input owner_secret;
    signal input owner_nonce;
    signal output commitment;
    signal output nullifier;

    is_long * (is_long - 1) === 0;
    component marginRange = BitsV1(128);
    component leverageRange = BitsV1(32);
    component secretRange = BitsV1(248);
    component nonceRange = BitsV1(128);
    marginRange.in <== margin;
    leverageRange.in <== leverage_bps;
    secretRange.in <== owner_secret;
    nonceRange.in <== owner_nonce;
    component minimumLeverage = LessEqV1(32);
    component maximumLeverage = LessEqV1(32);
    minimumLeverage.left <== 10000;
    minimumLeverage.right <== leverage_bps;
    maximumLeverage.left <== leverage_bps;
    maximumLeverage.right <== 100000;
    minimumLeverage.out === 1;
    maximumLeverage.out === 1;

    component owner = Compression(4);
    owner.in[0] <== perpPositionDomainV1();
    owner.in[1] <== adapter;
    owner.in[2] <== owner_secret;
    owner.in[3] <== owner_nonce;

    component terms = Compression(8);
    terms.in[0] <== perpOpenDomainV1();
    terms.in[1] <== chain_id;
    terms.in[2] <== market_low;
    terms.in[3] <== market_high;
    terms.in[4] <== is_long;
    terms.in[5] <== margin;
    terms.in[6] <== leverage_bps;
    terms.in[7] <== owner.out;
    commitment <== terms.out;

    component spent = Compression(4);
    spent.in[0] <== perpPositionNullifierDomainV1();
    spent.in[1] <== terms.out;
    spent.in[2] <== owner_secret;
    spent.in[3] <== owner_nonce;
    nullifier <== spent.out;
}
