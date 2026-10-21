import { privateVaultV2Abi } from "@zkblast/abi";
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import type { PrivateProverReleaseV2 } from "@zkblast/config";
import type { EthereumProvider } from "@/types/application";
import type { NoteScopeV2, StoredNoteV2 } from "./notecrypto-v2";
import type { PrivateIntentV2 } from "./private-v2-journal";
import {
  assertPrivateWalletV2,
  sendPrivateTransactionV2,
} from "./private-v2-funding";
import {
  decodeActionStatementV2,
  encodeReservationV2,
  fieldHexV2,
} from "./private-v2-intent";
import { calculatePrivateNoteV2 } from "./private-v2-notes";

/** Bind restored recovery records to the proof's actual resource slots and nullifiers. */
export async function assertPrivateIntentNotesV2(
  intent: PrivateIntentV2,
  notes: readonly StoredNoteV2[],
  manifest: PrivateProverReleaseV2,
  scope: NoteScopeV2,
): Promise<void> {
  const { inputs: p, sdkTerms: terms } = decodeActionStatementV2(
    intent.statement,
    scope,
  );
  const sameResource = (note: StoredNoteV2, slot: number) =>
    slot < 2
      ? note.resource.kind === "token" &&
        note.resource.address.toLowerCase() ===
          (slot === 0 ? terms.asset0 : terms.asset1).toLowerCase()
      : note.resource.kind === "lp" &&
        note.resource.address.toLowerCase() === terms.pool.toLowerCase() &&
        note.resource.model === terms.model &&
        note.resource.binId === String(terms.binId);
  const selected = intent.inputs.map((commitment) => {
    const note = notes.find((candidate) => candidate.commitment === commitment);
    if (!note) throw new Error("V2_INPUT_NOTE_MISSING");
    return note;
  });
  if (
    selected.some((note) => ![0, 1, 2].some((slot) => sameResource(note, slot)))
  )
    throw new Error("V2_INPUT_RESOURCE_MISMATCH");
  for (let slot = 0; slot < 3; slot += 1) {
    const matches = selected.filter((note) => sameResource(note, slot));
    if (matches.length > 1) throw new Error("V2_DUPLICATE_RESOURCE_INPUT");
    const input = matches[0];
    const output =
      p[17 + slot] === 0n
        ? undefined
        : notes.find((note) => note.commitment === String(p[17 + slot]));
    const refund =
      p[20 + slot] === 0n
        ? undefined
        : notes.find((note) => note.commitment === String(p[20 + slot]));
    if (
      (p[14 + slot] !== 0n) !== Boolean(input) ||
      (p[17 + slot] !== 0n) !== Boolean(output) ||
      Boolean(input) !== Boolean(refund) ||
      (output && !sameResource(output, slot)) ||
      (refund && !sameResource(refund, slot))
    )
      throw new Error("V2_RECOVERY_RESOURCE_MISMATCH");
    if (
      input &&
      BigInt((await calculatePrivateNoteV2(input, manifest)).nullifier) !==
        p[14 + slot]
    )
      throw new Error("V2_INPUT_NULLIFIER_MISMATCH");
    if (refund && refund.amount !== input?.amount)
      throw new Error("V2_REFUND_AMOUNT_MISMATCH");
    if (
      BigInt(input?.amount ?? "0") + p[23 + slot] !==
      BigInt(output?.amount ?? "0") + p[26 + slot] + p[29 + slot]
    )
      throw new Error("V2_NOTE_ACCOUNTING_MISMATCH");
  }
}

export async function privateIntentStateV2(
  provider: EthereumProvider,
  scope: NoteScopeV2,
  id: Hex,
): Promise<"unsubmitted" | "pending" | "settled" | "refunded"> {
  const chain = await provider.request({ method: "eth_chainId" });
  if (BigInt(chain as string) !== BigInt(scope.chainId))
    throw new Error("V2_SWITCH_TO_CONFIGURED_TESTNET");
  const data = (await provider.request({
    method: "eth_call",
    params: [
      {
        to: scope.settlement,
        data: encodeFunctionData({
          abi: privateVaultV2Abi,
          functionName: "intentStatus",
          args: [id],
        }),
      },
      "latest",
    ],
  })) as Hex;
  const state = decodeFunctionResult({
    abi: privateVaultV2Abi,
    functionName: "intentStatus",
    data,
  });
  const label = (["unsubmitted", "pending", "settled", "refunded"] as const)[
    state
  ];
  if (!label) throw new Error("INVALID_V2_INTENT_STATE");
  return label;
}

export async function assertNoteUnreservedV2(
  provider: EthereumProvider,
  note: StoredNoteV2,
  manifest: PrivateProverReleaseV2,
): Promise<void> {
  const identity = await calculatePrivateNoteV2(note, manifest);
  const data = (await provider.request({
    method: "eth_call",
    params: [
      {
        to: note.scope.settlement,
        data: encodeFunctionData({
          abi: privateVaultV2Abi,
          functionName: "nullifierIntent",
          args: [fieldHexV2(BigInt(identity.nullifier))],
        }),
      },
      "latest",
    ],
  })) as Hex;
  if (
    BigInt(
      decodeFunctionResult({
        abi: privateVaultV2Abi,
        functionName: "nullifierIntent",
        data,
      }),
    ) !== 0n
  )
    throw new Error("V2_NOTE_RESERVED_USE_INTENT_RECOVERY");
}

/** Permissionless settlement and expiry refund always return outputs to the private tree. */
export async function executePrivateIntentV2(
  args: Readonly<{
    operation: "reserve" | "settle" | "refund";
    notes: readonly StoredNoteV2[];
    manifest: PrivateProverReleaseV2;
    intent: PrivateIntentV2;
    scope: NoteScopeV2;
    provider: EthereumProvider;
    account: Address;
    onSubmitted: (hash: Hex) => Promise<void>;
  }>,
): Promise<Hex> {
  const { operation, intent, scope, provider, account } = args;
  await assertPrivateWalletV2(provider, account, scope.chainId);
  const decoded = decodeActionStatementV2(intent.statement, scope);
  await assertPrivateIntentNotesV2(intent, args.notes, args.manifest, scope);
  if (decoded.id !== intent.id.toLowerCase())
    throw new Error("V2_INTENT_ID_MISMATCH");
  const state = await privateIntentStateV2(provider, scope, decoded.id);
  if (
    (operation === "reserve" && state !== "unsubmitted") ||
    (operation !== "reserve" && state !== "pending")
  )
    throw new Error(`V2_INTENT_IS_${state.toUpperCase()}`);
  if (operation === "reserve" && !intent.reservationProof)
    throw new Error("V2_RESERVATION_PROOF_REQUIRED");
  const data =
    operation === "reserve"
      ? encodeReservationV2(intent.statement, scope, intent.reservationProof!)
      : operation === "settle"
        ? encodeFunctionData({
            abi: privateVaultV2Abi,
            functionName: "settle",
            args: [decoded.id, intent.statement],
          })
        : encodeFunctionData({
            abi: privateVaultV2Abi,
            functionName: "refund",
            args: [decoded.id],
          });
  return sendPrivateTransactionV2(
    provider,
    account,
    scope.chainId,
    scope.settlement,
    data,
    `Private v2 ${operation}`,
    args.onSubmitted,
  );
}
