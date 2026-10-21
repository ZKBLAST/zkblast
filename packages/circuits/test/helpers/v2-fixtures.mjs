// Synthetic local cryptographic fixtures only. Never use these fixed secrets for funds.
export function createActionFixtureBuilder(notes, merkle) {
  const context = {
    schema_version: "2",
    chain_id: "46630",
    settlement: "100",
    tree_version: "2",
    action: "2",
    terms_low: "123",
    terms_high: "456",
    deadline: "2000000000",
    asset0: "10",
    asset1: "20",
    pool: "30",
    pool_model: "0",
    bin_index: String(1 << 23),
  };
  async function hash(level, left, right) {
    return String(
      (await merkle.calculateWitness({ level, left, right }, true))[1],
    );
  }
  async function note(r, amount, secret, nonce, ctx) {
    const witness = await notes.calculateWitness(
      {
        chain_id: ctx.chain_id,
        settlement: ctx.settlement,
        tree_version: ctx.tree_version,
        resource_kind: r === 2 ? "1" : "0",
        resource_address: [ctx.asset0, ctx.asset1, ctx.pool][r],
        pool_model: r === 2 ? ctx.pool_model : "0",
        bin_index: r === 2 ? ctx.bin_index : String(1 << 23),
        amount: amount === 0 ? 1 : amount,
        secret,
        nonce,
        action: ctx.action,
        terms_low: ctx.terms_low,
        terms_high: ctx.terms_high,
        deadline: ctx.deadline,
        path_siblings: Array(32).fill("1"),
        path_directions: Array(32).fill("0"),
      },
      true,
    );
    return {
      commitment: amount === 0 ? "0" : String(witness[1]),
      nullifier: amount === 0 ? "0" : String(witness[3]),
    };
  }
  async function vector(
    inputAmounts,
    outputAmounts,
    inflows,
    outflows,
    fees,
    changes = {},
    options = {},
  ) {
    const ctx = { ...context, ...changes };
    const inputSecrets = options.inputSecrets ?? [101, 102, 103],
      inputNonces = options.inputNonces ?? [201, 202, 203];
    const outputSecrets = [301, 302, 303],
      outputNonces = [401, 402, 403];
    const refundSecrets = [501, 502, 503],
      refundNonces = [601, 602, 603];
    const inputs = [],
      outputs = [],
      refunds = [];
    for (let r = 0; r < 3; r++) {
      inputs.push(
        await note(r, inputAmounts[r], inputSecrets[r], inputNonces[r], ctx),
      );
      outputs.push(
        await note(r, outputAmounts[r], outputSecrets[r], outputNonces[r], ctx),
      );
      refunds.push(
        await note(r, inputAmounts[r], refundSecrets[r], refundNonces[r], ctx),
      );
    }
    const leaves =
      options.treeLeaves ??
      inputs.map((entry) =>
        entry.commitment === "0" ? "1" : entry.commitment,
      );
    const indices = options.leafIndices ?? [0, 1, 2];
    const tree = await treePaths(leaves, indices);
    return {
      ...ctx,
      merkle_root: tree.root,
      nullifiers: inputs.map((entry) => entry.nullifier),
      output_commitments: outputs.map((entry) => entry.commitment),
      refund_commitments: refunds.map((entry) => entry.commitment),
      refund_secrets: refundSecrets,
      refund_nonces: refundNonces,
      pool_inflows: inflows,
      pool_outflows: outflows,
      fees,
      input_amounts: inputAmounts,
      input_secrets: inputSecrets,
      input_nonces: inputNonces,
      output_amounts: outputAmounts,
      output_secrets: outputSecrets,
      output_nonces: outputNonces,
      leaf_indices: indices,
      path_siblings: tree.siblings,
      path_directions: tree.directions,
    };
  }
  async function treePaths(leaves, indices) {
    let nodes = [...leaves];
    let zero = "1";
    const siblings = [[], [], []];
    for (let level = 0; level < 32; level++) {
      for (let r = 0; r < 3; r++)
        siblings[r].push(nodes[(indices[r] >>> level) ^ 1] ?? zero);
      const next = [];
      for (let i = 0; i < nodes.length; i += 2)
        next.push(await hash(level, nodes[i], nodes[i + 1] ?? zero));
      zero = await hash(level, zero, zero);
      nodes = next;
    }
    return {
      root: nodes[0],
      siblings,
      directions: indices.map((r) =>
        Array.from({ length: 32 }, (_, level) => String((r >>> level) & 1)),
      ),
    };
  }
  return { context, hash, note, vector, treePaths };
}
