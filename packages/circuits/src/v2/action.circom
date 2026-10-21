pragma circom 2.2.3;
include "note.circom";
include "conservation.circom";

// Three resource slots: token0, token1, and the selected pool/bin LP share.
// Zero amount slots are disabled, represented by public zero commitment/nullifier.
// Terms hash and all public execution fields must be reconstructed by settlement;
// this circuit does not compute Keccak or authenticate pool receipts itself.
template PrivateActionV2(depth) {
    signal input schema_version;
    signal input chain_id;
    signal input settlement;
    signal input tree_version;
    signal input merkle_root;
    signal input action;
    signal input terms_low;
    signal input terms_high;
    signal input deadline;
    signal input asset0;
    signal input asset1;
    signal input pool;
    signal input pool_model;
    signal input bin_index;
    signal input nullifiers[3];
    signal input output_commitments[3];
    signal input refund_commitments[3];
    signal input pool_inflows[3];
    signal input pool_outflows[3];
    signal input fees[3];

    signal input input_amounts[3];
    signal input input_secrets[3];
    signal input input_nonces[3];
    signal input leaf_indices[3];
    signal input path_siblings[3][depth];
    signal input path_directions[3][depth];
    signal input output_amounts[3];
    signal input output_secrets[3];
    signal input output_nonces[3];
    signal input refund_secrets[3];
    signal input refund_nonces[3];

    schema_version === 2;
    component low = BitsV1(128);
    component high = BitsV1(128);
    component expiry = BitsV1(64);
    low.in <== terms_low;
    high.in <== terms_high;
    expiry.in <== deadline;
    component pairOrder = LessThanV1(160);
    pairOrder.left <== asset0;
    pairOrder.right <== asset1;
    pairOrder.out === 1;

    component inputZero[3];
    component outputZero[3];
    component notesIn[3];
    component notesOut[3];
    component notesRefund[3];
    component paths[3];
    component indices[3];
    component unchangedOutput[3];
    component unchangedRefund[3];
    component balance = PrivateConservationV2();
    balance.input_amounts <== input_amounts;
    balance.output_amounts <== output_amounts;
    balance.pool_inflows <== pool_inflows;
    balance.pool_outflows <== pool_outflows;
    balance.fees <== fees;

    for (var r = 0; r < 3; r++) {
        inputZero[r] = IsZeroV1();
        outputZero[r] = IsZeroV1();
        inputZero[r].in <== input_amounts[r];
        outputZero[r].in <== output_amounts[r];
        notesIn[r] = NoteV2();
        notesOut[r] = NoteV2();
        notesRefund[r] = NoteV2();
        notesIn[r].chain_id <== chain_id;
        notesOut[r].chain_id <== chain_id;
        notesIn[r].settlement <== settlement;
        notesOut[r].settlement <== settlement;
        notesIn[r].tree_version <== tree_version;
        notesOut[r].tree_version <== tree_version;
        notesIn[r].resource_kind <== r == 2 ? 1 : 0;
        notesOut[r].resource_kind <== r == 2 ? 1 : 0;
        notesIn[r].resource_address <== r == 0 ? asset0 : (r == 1 ? asset1 : pool);
        notesOut[r].resource_address <== r == 0 ? asset0 : (r == 1 ? asset1 : pool);
        notesIn[r].pool_model <== r == 2 ? pool_model : 0;
        notesOut[r].pool_model <== r == 2 ? pool_model : 0;
        notesIn[r].bin_index <== r == 2 ? bin_index : (1 << 23);
        notesOut[r].bin_index <== r == 2 ? bin_index : (1 << 23);
        notesIn[r].amount <== input_amounts[r] + inputZero[r].out;
        notesOut[r].amount <== output_amounts[r] + outputZero[r].out;
        notesIn[r].secret <== input_secrets[r];
        notesOut[r].secret <== output_secrets[r];
        notesIn[r].nonce <== input_nonces[r];
        notesOut[r].nonce <== output_nonces[r];
        nullifiers[r] === (1 - inputZero[r].out) * notesIn[r].nullifier;
        output_commitments[r] === (1 - outputZero[r].out) * notesOut[r].commitment;

        // Refund outputs preserve each input resource and its exact amount.
        // They are proven at reservation time, so expiry needs no online solver.
        notesRefund[r].chain_id <== chain_id;
        notesRefund[r].settlement <== settlement;
        notesRefund[r].tree_version <== tree_version;
        notesRefund[r].resource_kind <== r == 2 ? 1 : 0;
        notesRefund[r].resource_address <== r == 0 ? asset0 : (r == 1 ? asset1 : pool);
        notesRefund[r].pool_model <== r == 2 ? pool_model : 0;
        notesRefund[r].bin_index <== r == 2 ? bin_index : (1 << 23);
        notesRefund[r].amount <== input_amounts[r] + inputZero[r].out;
        notesRefund[r].secret <== refund_secrets[r];
        notesRefund[r].nonce <== refund_nonces[r];
        refund_commitments[r] === (1 - inputZero[r].out) * notesRefund[r].commitment;
        // Re-inserting an old commitment would keep its consumed nullifier and
        // strand the replacement note. Both terminal paths require fresh notes.
        unchangedOutput[r] = IsZeroV1();
        unchangedRefund[r] = IsZeroV1();
        unchangedOutput[r].in <== output_commitments[r] - notesIn[r].commitment;
        unchangedRefund[r].in <== refund_commitments[r] - notesIn[r].commitment;
        (1 - inputZero[r].out) * unchangedOutput[r].out === 0;
        (1 - inputZero[r].out) * unchangedRefund[r].out === 0;

        paths[r] = MerkleRootV2(depth);
        paths[r].leaf <== notesIn[r].commitment;
        paths[r].siblings <== path_siblings[r];
        paths[r].directions <== path_directions[r];
        (paths[r].out - merkle_root) * (1 - inputZero[r].out) === 0;
        indices[r] = BitsV1(depth);
        indices[r].in <== leaf_indices[r];
        for (var level = 0; level < depth; level++) {
            path_directions[r][level] === indices[r].bits[level];
        }
        // No wash exchange of the same resource inside one action.
        pool_inflows[r] * pool_outflows[r] === 0;
    }

    component anyInput = IsZeroV1();
    component anyOutput = IsZeroV1();
    anyInput.in <== input_amounts[0] + input_amounts[1] + input_amounts[2];
    anyOutput.in <== output_amounts[0] + output_amounts[1] + output_amounts[2];
    anyInput.out === 0;
    anyOutput.out === 0;

    component selected[3];
    for (var i = 0; i < 3; i++) {
        selected[i] = IsZeroV1();
        selected[i].in <== action - (i + 2);
    }
    selected[0].out + selected[1].out + selected[2].out === 1;
    component tokenInZero = IsZeroV1();
    component tokenOutZero = IsZeroV1();
    component shareInZero = IsZeroV1();
    component shareOutZero = IsZeroV1();
    tokenInZero.in <== pool_inflows[0] + pool_inflows[1];
    tokenOutZero.in <== pool_outflows[0] + pool_outflows[1];
    shareInZero.in <== pool_inflows[2];
    shareOutZero.in <== pool_outflows[2];

    // Swap: one token in, the other out; no LP share movement.
    selected[0].out * pool_inflows[2] === 0;
    selected[0].out * pool_outflows[2] === 0;
    selected[0].out * tokenInZero.out === 0;
    selected[0].out * tokenOutZero.out === 0;

    // LP add: assets leave custody and new shares enter it.
    selected[1].out * (pool_inflows[0] + pool_inflows[1]) === 0;
    selected[1].out * pool_outflows[2] === 0;
    selected[1].out * tokenOutZero.out === 0;
    selected[1].out * shareInZero.out === 0;
    // Both currently deployed pool models require two-sided liquidity adds.
    component out0Zero = IsZeroV1();
    component out1Zero = IsZeroV1();
    out0Zero.in <== pool_outflows[0];
    out1Zero.in <== pool_outflows[1];
    selected[1].out * out0Zero.out === 0;
    selected[1].out * out1Zero.out === 0;

    // LP remove: shares leave custody and redeemed assets enter it.
    selected[2].out * (pool_outflows[0] + pool_outflows[1]) === 0;
    selected[2].out * pool_inflows[2] === 0;
    selected[2].out * shareOutZero.out === 0;
    selected[2].out * tokenInZero.out === 0;
}

component main { public [
    schema_version, chain_id, settlement, tree_version, merkle_root, action,
    terms_low, terms_high, deadline, asset0, asset1, pool, pool_model, bin_index,
    nullifiers, output_commitments, refund_commitments, pool_inflows, pool_outflows, fees
] } = PrivateActionV2(32);
