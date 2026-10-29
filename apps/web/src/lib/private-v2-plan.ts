import {
  privateActionPublicInputsV2,
  shieldedTermsHashV2,
  type ShieldedTermsV2,
} from "@zkblast/sdk";
import type { PrivateProverReleaseV2 } from "@zkblast/config";
import { isPrivateV2Network } from "@zkblast/config";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import type {
  EthereumProvider,
  ProtocolExecutionPool,
} from "@/types/application";
import type { NoteScopeV2, StoredNoteV2 } from "./notecrypto-v2";
import type { PrivateIntentV2 } from "./private-v2-journal";
import {
  createPrivateNoteV2,
  calculatePrivateNoteV2,
} from "./private-v2-notes";
import { quotePrivateActionV2 } from "./private-v2-quotes";
import {
  assertPrivateWalletV2,
  encodePrivateProofV2,
} from "./private-v2-funding";
import { assertNoteUnreservedV2 } from "./private-v2-recovery";
import {
  encodeActionStatementV2,
  decodeActionStatementV2,
  fieldHexV2,
} from "./private-v2-intent";
import { proveInBrowserV2 } from "./private-v2-prover";
import { apiRequest } from "./api-client";

type Path = {
  root: string;
  leafIndex: number;
  siblings: string[];
  directions: number[];
};
export async function preparePrivateActionV2(
  args: Readonly<{
    scope: NoteScopeV2;
    manifest: PrivateProverReleaseV2;
    pool: ProtocolExecutionPool;
    action: "swap" | "add" | "remove";
    binId: number;
    inputNotes: readonly StoredNoteV2[];
    provider: EthereumProvider;
    account: Address;
    quoter?: Address;
    onStage: (stage: string) => void;
  }>,
): Promise<{ intent: PrivateIntentV2; notes: StoredNoteV2[] }> {
  const {
    scope,
    manifest,
    pool,
    action,
    binId,
    inputNotes,
    provider,
    account,
    onStage,
  } = args;
  await assertPrivateWalletV2(provider, account, scope.chainId);
  if (!isPrivateV2Network(scope.environment, scope.chainId))
    throw new Error("V2_SCOPE_NETWORK_UNSUPPORTED");
  const poolChainId = Number(pool.chainId);
  if (!Number.isSafeInteger(poolChainId))
    throw new Error("V2_POOL_CHAIN_INVALID");
  if (poolChainId !== Number(scope.chainId))
    throw new Error("V2_POOL_NETWORK_MISMATCH");
  if (!Number.isInteger(binId) || binId < -8388608 || binId >= 8388608)
    throw new Error("V2_DLMM_BIN_INVALID");
  if (pool.model === "damm" && binId !== 0)
    throw new Error("V2_DAMM_BIN_MUST_BE_ZERO");
  const resources: StoredNoteV2["resource"][] = [
    { kind: "token", address: pool.token0Address as Address },
    { kind: "token", address: pool.token1Address as Address },
    {
      kind: "lp",
      address: pool.address as Address,
      model: pool.model,
      binId: String(binId),
    },
  ];
  const slots: (StoredNoteV2 | null)[] = [null, null, null];
  for (const note of inputNotes) {
    const slot = resources.findIndex(
      (resource) =>
        JSON.stringify(resource).toLowerCase() ===
        JSON.stringify(note.resource).toLowerCase(),
    );
    if (slot < 0 || slots[slot])
      throw new Error("V2_SELECT_ONE_NOTE_PER_RESOURCE");
    slots[slot] = note;
    await assertNoteUnreservedV2(provider, note, manifest);
  }
  const amounts = slots.map((note) => BigInt(note?.amount ?? "0")) as [
    bigint,
    bigint,
    bigint,
  ];
  onStage("Reading pool state and private note paths");
  const quote = await quotePrivateActionV2(
    provider,
    pool,
    action,
    amounts,
    binId,
    args.quoter,
  );
  const paths: (Path | null)[] = await Promise.all(
    slots.map(async (note) =>
      note
        ? await apiRequest<Path>(
            "/api",
            `/v1/shielded-v2/path/${fieldHexV2(BigInt(note.commitment))}`,
          )
        : null,
    ),
  );
  const roots = paths
    .filter((path): path is Path => path !== null)
    .map((path) => String(BigInt(path.root)));
  if (!roots.length || new Set(roots).size !== 1)
    throw new Error("V2_TREE_CHANGED_RETRY_PREPARATION");
  for (const path of paths)
    if (
      path &&
      (path.siblings.length !== 32 ||
        path.directions.length !== 32 ||
        !Number.isSafeInteger(path.leafIndex) ||
        path.leafIndex < 0 ||
        path.leafIndex >= 2 ** 32)
    )
      throw new Error("INVALID_V2_MERKLE_PATH");
  const outputs: (StoredNoteV2 | null)[] = [],
    refunds: (StoredNoteV2 | null)[] = [];
  for (let slot = 0; slot < 3; slot += 1) {
    outputs.push(
      quote.inflows[slot] > 0n
        ? await createPrivateNoteV2(
            scope,
            resources[slot],
            String(quote.inflows[slot]),
            "output",
            manifest,
          )
        : null,
    );
    refunds.push(
      slots[slot]
        ? await createPrivateNoteV2(
            scope,
            resources[slot],
            slots[slot]!.amount,
            "refund",
            manifest,
          )
        : null,
    );
  }
  const ids = await Promise.all(
    slots.map(async (note) =>
      note ? await calculatePrivateNoteV2(note, manifest) : null,
    ),
  );
  const commitments = (notes: readonly (StoredNoteV2 | null)[]) =>
    notes.map((note) => BigInt(note?.commitment ?? "0")) as [
      bigint,
      bigint,
      bigint,
    ];
  const outputCommitments = commitments(outputs),
    refundCommitments = commitments(refunds);
  const terms: ShieldedTermsV2 = {
    chainId: BigInt(scope.chainId),
    settlement: scope.settlement,
    action:
      action === "swap"
        ? "swap"
        : action === "add"
          ? "add-liquidity"
          : "remove-liquidity",
    pool: pool.address as Address,
    model: pool.model,
    binId: BigInt(binId),
    asset0: pool.token0Address as Address,
    asset1: pool.token1Address as Address,
    amount0: quote.outflows[0],
    amount1: quote.outflows[1],
    shares: quote.outflows[2],
    minimum0: quote.inflows[0],
    minimum1: quote.inflows[1],
    minimumShares: quote.inflows[2],
    maximumFee0: 0n,
    maximumFee1: 0n,
    feeRecipient: scope.settlement,
    deadline: quote.deadline,
    refundCommitment: keccak256(
      encodeAbiParameters(
        [{ type: "bytes32[3]" }],
        [refundCommitments.map(fieldHexV2) as [Address, Address, Address]],
      ),
    ),
    outputCommitment0: fieldHexV2(outputCommitments[0]),
    outputCommitment1: fieldHexV2(outputCommitments[1]),
  };
  const signals = privateActionPublicInputsV2({
    schemaVersion: 2,
    chainId: BigInt(scope.chainId),
    settlement: scope.settlement,
    treeVersion: BigInt(scope.treeVersion),
    merkleRoot: BigInt(roots[0]),
    action: terms.action,
    termsHash: shieldedTermsHashV2(terms),
    deadline: quote.deadline,
    asset0: terms.asset0,
    asset1: terms.asset1,
    pool: terms.pool,
    model: pool.model,
    binId: BigInt(binId),
    nullifiers: ids.map((identity) => BigInt(identity?.nullifier ?? "0")) as [
      bigint,
      bigint,
      bigint,
    ],
    outputCommitments,
    refundCommitments,
    poolInflows: quote.inflows,
    poolOutflows: quote.outflows,
    fees: [0n, 0n, 0n],
  });
  const names = [
    "schema_version",
    "chain_id",
    "settlement",
    "tree_version",
    "merkle_root",
    "action",
    "terms_low",
    "terms_high",
    "deadline",
    "asset0",
    "asset1",
    "pool",
    "pool_model",
    "bin_index",
  ];
  const input = {
    ...Object.fromEntries(
      names.map((name, index) => [name, String(signals[index])]),
    ),
    nullifiers: signals.slice(14, 17).map(String),
    output_commitments: outputCommitments.map(String),
    refund_commitments: refundCommitments.map(String),
    pool_inflows: quote.inflows.map(String),
    pool_outflows: quote.outflows.map(String),
    fees: ["0", "0", "0"],
    input_amounts: amounts.map(String),
    input_secrets: slots.map((note) => note?.secret ?? "1"),
    input_nonces: slots.map((note) => note?.nonce ?? "0"),
    leaf_indices: paths.map((path) => String(path?.leafIndex ?? 0)),
    path_siblings: paths.map((path) =>
      path
        ? path.siblings.map((value) => String(BigInt(value)))
        : Array<string>(32).fill("0"),
    ),
    path_directions: paths.map((path) =>
      path ? path.directions.map(String) : Array<string>(32).fill("0"),
    ),
    output_amounts: outputs.map((note) => note?.amount ?? "0"),
    output_secrets: outputs.map((note) => note?.secret ?? "1"),
    output_nonces: outputs.map((note) => note?.nonce ?? "0"),
    refund_secrets: refunds.map((note) => note?.secret ?? "1"),
    refund_nonces: refunds.map((note) => note?.nonce ?? "0"),
  };
  const proof = await proveInBrowserV2(
    {
      kind: "action",
      scope,
      manifest: { ...manifest, ...manifest.action, ...scope },
      input,
      expectedPublicInputs: signals.map(String),
    },
    {
      onStage: (stage) =>
        onStage(
          stage === "proving"
            ? "Proving private action locally"
            : "Verifying action proof locally",
        ),
    },
  );
  const statement = encodeActionStatementV2(terms, signals, quote.crossings);
  const { id } = decodeActionStatementV2(statement, scope);
  return {
    intent: {
      id,
      action,
      statement,
      inputs: slots
        .filter((note): note is StoredNoteV2 => note !== null)
        .map((note) => note.commitment),
      outputs: outputs
        .filter((note): note is StoredNoteV2 => note !== null)
        .map((note) => note.commitment),
      refunds: refunds
        .filter((note): note is StoredNoteV2 => note !== null)
        .map((note) => note.commitment),
      reservationProof: encodePrivateProofV2(proof),
    },
    notes: [...outputs, ...refunds].filter(
      (note): note is StoredNoteV2 => note !== null,
    ),
  };
}
