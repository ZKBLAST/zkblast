pragma circom 2.2.3;
include "position.circom";

template PrivatePerpModifyV1() {
    signal input schema_version;
    signal input action;
    signal input chain_id;
    signal input adapter;
    signal input market_low;
    signal input market_high;
    signal input is_long;
    signal input old_margin;
    signal input expected_new_margin;
    signal input old_leverage_bps;
    signal input new_leverage_bps;
    signal input old_position_commitment;
    signal input old_position_nullifier;
    signal input new_position_commitment;
    signal input acceptable_close_price_x18;
    signal input acceptable_open_price_x18;
    signal input deadline;
    signal input relayer;
    signal input relayer_fee;

    signal input old_owner_secret;
    signal input old_owner_nonce;
    signal input new_owner_secret;
    signal input new_owner_nonce;

    schema_version === 1;
    action === 3;
    component closePriceRange = BitsV1(128);
    component openPriceRange = BitsV1(128);
    component oldMarginRange = BitsV1(128);
    component newMarginRange = BitsV1(128);
    component deadlineRange = BitsV1(64);
    component feeRange = BitsV1(128);
    closePriceRange.in <== acceptable_close_price_x18;
    openPriceRange.in <== acceptable_open_price_x18;
    oldMarginRange.in <== old_margin;
    newMarginRange.in <== expected_new_margin;
    deadlineRange.in <== deadline;
    feeRange.in <== relayer_fee;

    component oldPosition = PerpPositionCommitmentV1();
    oldPosition.chain_id <== chain_id;
    oldPosition.adapter <== adapter;
    oldPosition.market_low <== market_low;
    oldPosition.market_high <== market_high;
    oldPosition.is_long <== is_long;
    oldPosition.margin <== old_margin;
    oldPosition.leverage_bps <== old_leverage_bps;
    oldPosition.owner_secret <== old_owner_secret;
    oldPosition.owner_nonce <== old_owner_nonce;
    oldPosition.commitment === old_position_commitment;
    oldPosition.nullifier === old_position_nullifier;

    component newPosition = PerpPositionCommitmentV1();
    newPosition.chain_id <== chain_id;
    newPosition.adapter <== adapter;
    newPosition.market_low <== market_low;
    newPosition.market_high <== market_high;
    newPosition.is_long <== is_long;
    newPosition.margin <== expected_new_margin;
    newPosition.leverage_bps <== new_leverage_bps;
    newPosition.owner_secret <== new_owner_secret;
    newPosition.owner_nonce <== new_owner_nonce;
    newPosition.commitment === new_position_commitment;
    component changed = IsZeroV1();
    changed.in <== new_position_commitment - old_position_commitment;
    changed.out === 0;
}

component main { public [
    schema_version, action, chain_id, adapter, market_low, market_high, is_long,
    old_margin, expected_new_margin, old_leverage_bps, new_leverage_bps, old_position_commitment,
    old_position_nullifier, new_position_commitment, acceptable_close_price_x18,
    acceptable_open_price_x18, deadline, relayer, relayer_fee
] } = PrivatePerpModifyV1();
