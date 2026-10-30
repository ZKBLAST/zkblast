import {
  decryptPrivatePayloadV2,
  encryptPrivatePayloadV2,
  type NoteScopeV2,
} from "./notecrypto-v2";

export type PrivatePerpsRecord = Readonly<{
  positionCommitment: string;
  marketId: `0x${string}`;
  isLong: boolean;
  marginRaw: string;
  leverageBps: number;
  ownerSecret: string;
  ownerNonce: string;
  operation?: "open" | "close" | "modify" | "claim-liquidated";
  generatedNoteCommitment?: string;
  replacesCommitment?: string;
  status: "prepared" | "open" | "modifying" | "closing" | "closed" | "liquidated";
  relayRequestId?: `0x${string}`;
  transactionHash?: `0x${string}`;
}>;

export type PrivatePerpsJournal = Readonly<{
  format: "zkblast-private-perps-journal";
  version: 1;
  records: readonly PrivatePerpsRecord[];
}>;

const bytes32 = /^0x[0-9a-f]{64}$/iu;
const decimal = /^(0|[1-9][0-9]{0,77})$/u;
const operations = ["open", "close", "modify", "claim-liquidated"] as const;
const statuses = ["prepared", "open", "modifying", "closing", "closed", "liquidated"] as const;

function objectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function operation(value: unknown): value is NonNullable<PrivatePerpsRecord["operation"]> {
  return typeof value === "string" && operations.some((item) => item === value);
}

function status(value: unknown): value is PrivatePerpsRecord["status"] {
  return typeof value === "string" && statuses.some((item) => item === value);
}

export const emptyPrivatePerpsJournal = (): PrivatePerpsJournal => ({
  format: "zkblast-private-perps-journal",
  version: 1,
  records: [],
});

export function privatePerpsJournalKey(scope: NoteScopeV2): string {
  return `zkblast:private-perps-journal:v1:${scope.environment}:${scope.chainId}:${scope.settlement.toLowerCase()}:${scope.treeVersion}`;
}

export function validatePrivatePerpsJournal(value: unknown): PrivatePerpsJournal {
  if (!objectRecord(value)) throw new Error("INVALID_PRIVATE_PERPS_JOURNAL");
  const journal = value;
  if (
    journal.format !== "zkblast-private-perps-journal" || journal.version !== 1
      || !Array.isArray(journal.records) || journal.records.length > 128
  ) throw new Error("INVALID_PRIVATE_PERPS_JOURNAL");
  const commitments = new Set<string>();
  const records: PrivatePerpsRecord[] = journal.records.map((record: unknown) => {
    if (!objectRecord(record)) throw new Error("INVALID_PRIVATE_PERPS_RECORD");
    const positionCommitment = record.positionCommitment;
    const marketId = record.marketId;
    const marginRaw = record.marginRaw;
    const leverageBps = record.leverageBps;
    const ownerSecret = record.ownerSecret;
    const ownerNonce = record.ownerNonce;
    if (
      typeof positionCommitment !== "string" || !decimal.test(positionCommitment) || BigInt(positionCommitment) === 0n
        || typeof marketId !== "string" || !bytes32.test(marketId)
        || typeof marginRaw !== "string" || !decimal.test(marginRaw)
        || typeof leverageBps !== "number" || leverageBps < 10_000 || leverageBps > 100_000
        || typeof ownerSecret !== "string" || !decimal.test(ownerSecret)
        || typeof ownerNonce !== "string" || !decimal.test(ownerNonce)
        || (record.operation !== undefined && !operation(record.operation))
        || (record.generatedNoteCommitment !== undefined && (typeof record.generatedNoteCommitment !== "string" || !decimal.test(record.generatedNoteCommitment)))
        || (record.replacesCommitment !== undefined && (typeof record.replacesCommitment !== "string" || !decimal.test(record.replacesCommitment)))
        || !status(record.status)
        || (record.relayRequestId !== undefined && (typeof record.relayRequestId !== "string" || !bytes32.test(record.relayRequestId)))
        || (record.transactionHash !== undefined && (typeof record.transactionHash !== "string" || !bytes32.test(record.transactionHash)))
        || typeof record.isLong !== "boolean"
    ) throw new Error("INVALID_PRIVATE_PERPS_RECORD");
    if (commitments.has(positionCommitment)) throw new Error("DUPLICATE_PRIVATE_PERPS_POSITION");
    commitments.add(positionCommitment);
    return {
      positionCommitment,
      marketId: marketId as `0x${string}`,
      isLong: record.isLong,
      marginRaw,
      leverageBps,
      ownerSecret,
      ownerNonce,
      status: record.status,
      ...(operation(record.operation) ? { operation: record.operation } : {}),
      ...(typeof record.generatedNoteCommitment === "string" ? { generatedNoteCommitment: record.generatedNoteCommitment } : {}),
      ...(typeof record.replacesCommitment === "string" ? { replacesCommitment: record.replacesCommitment } : {}),
      ...(typeof record.relayRequestId === "string" ? { relayRequestId: record.relayRequestId as `0x${string}` } : {}),
      ...(typeof record.transactionHash === "string" ? { transactionHash: record.transactionHash as `0x${string}` } : {}),
    };
  });
  return { format: "zkblast-private-perps-journal", version: 1, records };
}

export async function savePrivatePerpsJournal(
  storage: Pick<Storage, "setItem">,
  journal: PrivatePerpsJournal,
  passphrase: string,
  scope: NoteScopeV2,
): Promise<void> {
  const encrypted = await encryptPrivatePayloadV2(
    validatePrivatePerpsJournal(journal), passphrase, scope, "perps-journal",
  );
  storage.setItem(privatePerpsJournalKey(scope), JSON.stringify(encrypted));
}

export async function loadPrivatePerpsJournal(
  storage: Pick<Storage, "getItem">,
  passphrase: string,
  scope: NoteScopeV2,
): Promise<PrivatePerpsJournal> {
  const serialized = storage.getItem(privatePerpsJournalKey(scope));
  if (!serialized) return emptyPrivatePerpsJournal();
  return decryptPrivatePerpsJournal(serialized, passphrase, scope);
}

export async function decryptPrivatePerpsJournal(
  serialized: string,
  passphrase: string,
  scope: NoteScopeV2,
): Promise<PrivatePerpsJournal> {
  return validatePrivatePerpsJournal(
    await decryptPrivatePayloadV2(serialized, passphrase, scope, "perps-journal"),
  );
}

export function privatePerpsJournalError(error: unknown): string {
  if (error instanceof DOMException && error.name === "OperationError") {
    return "Passphrase does not match the private Perps journal saved in this browser.";
  }
  return error instanceof Error ? error.message : "PRIVATE_PERPS_JOURNAL_FAILED";
}
