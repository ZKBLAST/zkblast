pragma circom 2.2.3;

include "position.circom";

template PrivatePerpOpenV1(depth) {
    signal input schema_version;
    signal input action;
    signal input chain_id;
    signal input adapter;
    signal input custody;
    signal input collateral;
    signal input tree_version;
    signal input merkle_root;
    signal input market_low;
    signal input market_high;
    signal input is_long;
    signal input margin;
    signal input leverage_bps;
    signal input acceptable_price_x18;
    signal input deadline;
    signal input nullifier;
    signal input position_commitment;
    signal input refund_commitment;
    signal input relayer;
    signal input relayer_fee;

    signal input note_amount;
    signal input note_secret;
    signal input note_nonce;
    signal input leaf_index;
    signal input path_siblings[depth];
    signal input path_directions[depth];
    signal input refund_amount;
    signal input refund_secret;
    signal input refund_nonce;
    signal input position_owner_secret;
    signal input position_owner_nonce;

    schema_version === 1;
    action === 1;
    component deadlineRange = BitsV1(64);
    component priceRange = BitsV1(128);
    component feeRange = BitsV1(128);
    deadlineRange.in <== deadline;
    priceRange.in <== acceptable_price_x18;
    feeRange.in <== relayer_fee;
    note_amount === margin + relayer_fee + refund_amount;

    component note = NoteV2();
    note.chain_id <== chain_id;
    note.settlement <== custody;
    note.tree_version <== tree_version;
    note.resource_kind <== 0;
    note.resource_address <== collateral;
    note.pool_model <== 0;
    note.bin_index <== (1 << 23);
    note.amount <== note_amount;
    note.secret <== note_secret;
    note.nonce <== note_nonce;
    note.nullifier === nullifier;

    component path = MerkleRootV2(depth);
    path.leaf <== note.commitment;
    path.siblings <== path_siblings;
    path.directions <== path_directions;
    path.out === merkle_root;
    component index = BitsV1(depth);
    index.in <== leaf_index;
    for (var level = 0; level < depth; level++) {
        path_directions[level] === index.bits[level];
    }

    component refund = NoteV2();
    refund.chain_id <== chain_id;
    refund.settlement <== custody;
    refund.tree_version <== tree_version;
    refund.resource_kind <== 0;
    refund.resource_address <== collateral;
    refund.pool_model <== 0;
    refund.bin_index <== (1 << 23);
    refund.amount <== refund_amount;
    refund.secret <== refund_secret;
    refund.nonce <== refund_nonce;
    refund.commitment === refund_commitment;

    component position = PerpPositionCommitmentV1();
    position.chain_id <== chain_id;
    position.adapter <== adapter;
    position.market_low <== market_low;
    position.market_high <== market_high;
    position.is_long <== is_long;
    position.margin <== margin;
    position.leverage_bps <== leverage_bps;
    position.owner_secret <== position_owner_secret;
    position.owner_nonce <== position_owner_nonce;
    position.commitment === position_commitment;
}

component main { public [
    schema_version, action, chain_id, adapter, custody, collateral, tree_version, merkle_root,
    market_low, market_high, is_long, margin, leverage_bps, acceptable_price_x18,
    deadline, nullifier, position_commitment, refund_commitment, refund_amount, relayer, relayer_fee
] } = PrivatePerpOpenV1(32);
