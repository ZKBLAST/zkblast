pragma circom 2.2.3;

include "position.circom";

template PrivatePerpCloseV1() {
    signal input schema_version;
    signal input action;
    signal input chain_id;
    signal input adapter;
    signal input custody;
    signal input collateral;
    signal input tree_version;
    signal input market_low;
    signal input market_high;
    signal input position_commitment;
    signal input position_nullifier;
    signal input expected_payout;
    signal input acceptable_price_x18;
    signal input deadline;
    signal input payout_commitment;
    signal input relayer;
    signal input relayer_fee;

    signal input is_long;
    signal input margin;
    signal input leverage_bps;
    signal input position_owner_secret;
    signal input position_owner_nonce;
    signal input payout_secret;
    signal input payout_nonce;

    schema_version === 1;
    action === 2;
    component deadlineRange = BitsV1(64);
    component payoutRange = BitsV1(128);
    component priceRange = BitsV1(128);
    component feeRange = BitsV1(128);
    deadlineRange.in <== deadline;
    payoutRange.in <== expected_payout;
    priceRange.in <== acceptable_price_x18;
    feeRange.in <== relayer_fee;

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
    position.nullifier === position_nullifier;

    component payout = NoteV2();
    payout.chain_id <== chain_id;
    payout.settlement <== custody;
    payout.tree_version <== tree_version;
    payout.resource_kind <== 0;
    payout.resource_address <== collateral;
    payout.pool_model <== 0;
    payout.bin_index <== (1 << 23);
    payout.amount <== expected_payout - relayer_fee;
    payout.secret <== payout_secret;
    payout.nonce <== payout_nonce;
    payout.commitment === payout_commitment;
}

component main { public [
    schema_version, action, chain_id, adapter, custody, collateral, tree_version,
    market_low, market_high, position_commitment, position_nullifier,
    expected_payout, acceptable_price_x18, deadline, payout_commitment, relayer, relayer_fee
] } = PrivatePerpCloseV1();
