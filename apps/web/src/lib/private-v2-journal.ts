import {
  decryptPrivatePayloadV2,
  encryptPrivatePayloadV2,
  encryptedStorageKeyV2,
  validateStoredNoteV2,
  type NoteScopeV2,
  type StoredNoteV2,
} from "./notecrypto-v2";
import { decodeActionStatementV2 } from "./private-v2-intent";

export type PrivateIntentV2 = Readonly<{
  id: string;
  action: "swap" | "add" | "remove";
  inputs: readonly string[];
  outputs: readonly string[];
  refunds: readonly string[];
  statement: `0x${string}`;
  reservationProof?: `0x${string}`;
}>;
export type PrivateJournalV2 = Readonly<{
  format: "zkblast-private-journal";
  version: 2;
  notes: readonly StoredNoteV2[];
  intents: readonly PrivateIntentV2[];
  archivedIntents: readonly string[];
  transactions: readonly Readonly<{
    hash: string;
    operation: "deposit" | "withdraw" | "reserve" | "settle" | "refund";
    commitment: string;
  }>[];
}>;
export const emptyJournalV2 = (): PrivateJournalV2 => ({
  format: "zkblast-private-journal",
  version: 2,
  notes: [],
  intents: [],
  archivedIntents: [],
  transactions: [],
});
const decimal = /^[1-9][0-9]{0,76}$/u;
const bytes32 = /^0x[0-9a-f]{64}$/iu;

export function journalStorageKeyV2(scope: NoteScopeV2): string {
  return `${encryptedStorageKeyV2(scope)}:journal`;
}

/** Intent IDs and recovery notes are immutable; chain state is queried separately, never trusted from backups. */
export function validateJournalV2(
  value: unknown,
  scope: NoteScopeV2,
): PrivateJournalV2 {
  if (!value || typeof value !== "object")
    throw new Error("INVALID_V2_JOURNAL");
  const journal = value as PrivateJournalV2;
  const archivedIntents = journal.archivedIntents ?? [];
  if (
    !Array.isArray(archivedIntents) ||
    archivedIntents.length > 128 ||
    !archivedIntents.every(
      (id: unknown) => typeof id === "string" && bytes32.test(id),
    ) ||
    new Set(archivedIntents).size !== archivedIntents.length
  )
    throw new Error("INVALID_V2_ARCHIVED_INTENTS");
  if (
    journal.format !== "zkblast-private-journal" ||
    journal.version !== 2 ||
    !Array.isArray(journal.notes) ||
    journal.notes.length > 512 ||
    !Array.isArray(journal.intents) ||
    journal.intents.length > 128 ||
    !Array.isArray(journal.transactions) ||
    journal.transactions.length > 1024
  )
    throw new Error("INVALID_V2_JOURNAL");
  const notes = journal.notes.map((note: unknown) =>
    validateStoredNoteV2(note, scope),
  );
  const known = new Map(notes.map((note) => [note.commitment, note]));
  if (known.size !== notes.length) throw new Error("DUPLICATE_V2_NOTE");
  const locked = new Set<string>();
  const ids = new Set<string>();
  const intents = journal.intents.map((intent: PrivateIntentV2) => {
    if (
      !intent ||
      !bytes32.test(intent.id) ||
      ids.has(intent.id.toLowerCase()) ||
      !["swap", "add", "remove"].includes(intent.action) ||
      typeof intent.statement !== "string" ||
      intent.statement.length > 32768 ||
      !/^0x(?:[0-9a-f]{2})+$/iu.test(intent.statement)
    )
      throw new Error("INVALID_V2_INTENT");
    ids.add(intent.id.toLowerCase());
    if (intent.reservationProof !== undefined) {
      if (!/^0x[0-9a-f]{512}$/iu.test(intent.reservationProof))
        throw new Error("INVALID_V2_PROOF_ENCODING");
      const decoded = decodeActionStatementV2(intent.statement, scope);
      const expectedAction =
        decoded.action === "swap"
          ? "swap"
          : decoded.action === "add-liquidity"
            ? "add"
            : "remove";
      if (
        decoded.id !== intent.id.toLowerCase() ||
        expectedAction !== intent.action ||
        JSON.stringify(
          decoded.inputs
            .slice(17, 20)
            .filter((value) => value !== 0n)
            .map(String),
        ) !== JSON.stringify(intent.outputs) ||
        JSON.stringify(
          decoded.inputs
            .slice(20, 23)
            .filter((value) => value !== 0n)
            .map(String),
        ) !== JSON.stringify(intent.refunds)
      )
        throw new Error("V2_INTENT_BINDING_MISMATCH");
    }
    for (const list of [intent.inputs, intent.outputs, intent.refunds]) {
      if (
        !Array.isArray(list) ||
        list.length < 1 ||
        list.length > 3 ||
        new Set(list).size !== list.length ||
        !list.every(
          (commitment: unknown) =>
            typeof commitment === "string" &&
            decimal.test(commitment) &&
            known.has(commitment),
        )
      )
        throw new Error("V2_RECOVERY_NOTES_REQUIRED");
    }
    if (intent.inputs.length !== intent.refunds.length)
      throw new Error("V2_REFUND_COUNT_MISMATCH");
    for (const input of intent.inputs) {
      if (archivedIntents.includes(intent.id.toLowerCase())) continue;
      if (locked.has(input)) throw new Error("V2_INPUT_ALREADY_RESERVED");
      locked.add(input);
    }
    if (
      new Set([...intent.inputs, ...intent.outputs, ...intent.refunds]).size !==
      intent.inputs.length + intent.outputs.length + intent.refunds.length
    )
      throw new Error("V2_RECOVERY_COMMITMENT_REUSE");
    for (const commitment of intent.outputs)
      if (known.get(commitment)!.role !== "output")
        throw new Error("INVALID_V2_OUTPUT_ROLE");
    for (let index = 0; index < intent.inputs.length; index += 1) {
      const input = known.get(intent.inputs[index])!;
      const refund = known.get(intent.refunds[index])!;
      if (
        refund.role !== "refund" ||
        refund.amount !== input.amount ||
        JSON.stringify(refund.resource).toLowerCase() !==
          JSON.stringify(input.resource).toLowerCase()
      )
        throw new Error("V2_REFUND_RESOURCE_MISMATCH");
    }
    return {
      id: intent.id.toLowerCase(),
      action: intent.action,
      inputs: [...intent.inputs],
      outputs: [...intent.outputs],
      refunds: [...intent.refunds],
      statement: intent.statement,
      ...(intent.reservationProof
        ? { reservationProof: intent.reservationProof }
        : {}),
    };
  });
  if (archivedIntents.some((id: string) => !ids.has(id)))
    throw new Error("UNKNOWN_V2_ARCHIVED_INTENT");
  const transactions = journal.transactions.map(
    (transaction: PrivateJournalV2["transactions"][number]) => {
      if (
        !transaction ||
        !bytes32.test(transaction.hash) ||
        !["deposit", "withdraw", "reserve", "settle", "refund"].includes(
          transaction.operation,
        ) ||
        !known.has(transaction.commitment)
      )
        throw new Error("INVALID_V2_TRANSACTION_RECORD");
      return {
        hash: transaction.hash.toLowerCase(),
        operation: transaction.operation,
        commitment: transaction.commitment,
      };
    },
  );
  if (
    new Set(transactions.map((transaction) => transaction.hash)).size !==
    transactions.length
  )
    throw new Error("DUPLICATE_V2_TRANSACTION");
  return {
    format: "zkblast-private-journal",
    version: 2,
    notes,
    intents,
    archivedIntents: archivedIntents.map((id: string) => id),
    transactions,
  };
}

export function mergeJournalsV2(
  current: PrivateJournalV2,
  incoming: PrivateJournalV2,
  scope: NoteScopeV2,
): PrivateJournalV2 {
  const notes = new Map(current.notes.map((note) => [note.commitment, note]));
  for (const note of incoming.notes) {
    const old = notes.get(note.commitment);
    if (old && JSON.stringify(old) !== JSON.stringify(note))
      throw new Error("V2_NOTE_CONFLICT");
    notes.set(note.commitment, note);
  }
  const intents = new Map(current.intents.map((intent) => [intent.id, intent]));
  for (const intent of incoming.intents) {
    const old = intents.get(intent.id);
    if (old && JSON.stringify(old) !== JSON.stringify(intent))
      throw new Error("V2_INTENT_CONFLICT");
    intents.set(intent.id, intent);
  }
  const transactions = new Map(
    current.transactions.map((transaction) => [transaction.hash, transaction]),
  );
  for (const transaction of incoming.transactions) {
    const old = transactions.get(transaction.hash);
    if (old && JSON.stringify(old) !== JSON.stringify(transaction))
      throw new Error("V2_TRANSACTION_CONFLICT");
    transactions.set(transaction.hash, transaction);
  }
  return validateJournalV2(
    {
      ...emptyJournalV2(),
      notes: [...notes.values()],
      intents: [...intents.values()],
      archivedIntents: [
        ...new Set([
          ...(current.archivedIntents ?? []),
          ...(incoming.archivedIntents ?? []),
        ]),
      ],
      transactions: [...transactions.values()],
    },
    scope,
  );
}

export async function decryptJournalV2(
  serialized: string,
  passphrase: string,
  scope: NoteScopeV2,
  verify: (note: StoredNoteV2) => Promise<boolean>,
): Promise<PrivateJournalV2> {
  const journal = validateJournalV2(
    await decryptPrivatePayloadV2(serialized, passphrase, scope, "journal"),
    scope,
  );
  for (const note of journal.notes)
    if (!(await verify(note))) throw new Error("V2_NOTE_COMMITMENT_MISMATCH");
  return journal;
}

/** The caller supplies Web Locks; no unsafe unlocked fallback for concurrent browser tabs. */
export async function persistJournalV2(
  incoming: PrivateJournalV2,
  passphrase: string,
  scope: NoteScopeV2,
  dependencies: Readonly<{
    storage: Pick<Storage, "getItem" | "setItem">;
    lock: <T>(name: string, work: () => Promise<T>) => Promise<T>;
    verify: (note: StoredNoteV2) => Promise<boolean>;
  }>,
): Promise<PrivateJournalV2> {
  const storageKey = journalStorageKeyV2(scope);
  return dependencies.lock(storageKey, async () => {
    const previous = dependencies.storage.getItem(storageKey);
    const current = previous
      ? await decryptJournalV2(previous, passphrase, scope, dependencies.verify)
      : emptyJournalV2();
    const validated = validateJournalV2(incoming, scope);
    for (const note of validated.notes)
      if (!(await dependencies.verify(note)))
        throw new Error("V2_NOTE_COMMITMENT_MISMATCH");
    const merged = mergeJournalsV2(current, validated, scope);
    const backup = await encryptPrivatePayloadV2(
      merged,
      passphrase,
      scope,
      "journal",
    );
    if (dependencies.storage.getItem(storageKey) !== previous)
      throw new Error("V2_JOURNAL_CHANGED_RETRY");
    dependencies.storage.setItem(storageKey, JSON.stringify(backup));
    if (dependencies.storage.getItem(storageKey) !== JSON.stringify(backup))
      throw new Error("V2_JOURNAL_WRITE_FAILED");
    return merged;
  });
}
