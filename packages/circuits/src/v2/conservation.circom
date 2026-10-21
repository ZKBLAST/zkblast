pragma circom 2.2.3;

include "../v1/constraints.circom";

// Accounting gadget only, NOT an ownership/settlement proof. Resource indices
// must be bound to authenticated token0, token1 and pool/bin LP note identities
// by the future membership/action circuit. No deployed v1 entrypoint uses this.
template PrivateConservationV2() {
    signal input input_amounts[3];
    signal input output_amounts[3];
    signal input pool_inflows[3];
    signal input pool_outflows[3];
    signal input fees[3];

    component inputBits[3];
    component outputBits[3];
    component inflowBits[3];
    component outflowBits[3];
    component feeBits[3];

    for (var resource = 0; resource < 3; resource++) {
        inputBits[resource] = BitsV1(128);
        outputBits[resource] = BitsV1(128);
        inflowBits[resource] = BitsV1(128);
        outflowBits[resource] = BitsV1(128);
        feeBits[resource] = BitsV1(128);
        inputBits[resource].in <== input_amounts[resource];
        outputBits[resource].in <== output_amounts[resource];
        inflowBits[resource].in <== pool_inflows[resource];
        outflowBits[resource].in <== pool_outflows[resource];
        feeBits[resource].in <== fees[resource];

        // At most three uint128 terms per side: integer equality cannot wrap
        // the BN254 scalar field. No implicit exchange between resources.
        input_amounts[resource] + pool_inflows[resource] ===
            output_amounts[resource] + pool_outflows[resource] + fees[resource];
    }
    // Fees are denominated in tokens, never minted/burned as LP shares.
    fees[2] === 0;
}
