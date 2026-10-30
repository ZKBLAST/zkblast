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

export const emptyPrivatePerpsJournal = (): PrivatePerpsJournal => ({
  format: "zkblast-private-perps-journal",
  version: 1,
  records: [],
});

export function privatePerpsJournalKey(scope: NoteScopeV2): string {
  return `zkblast:private-perps-journal:v1:${scope.environment}:${scope.chainId}:${scope.settlement.toLowerCase()}:${scope.treeVersion}`;
}

export function validatePrivatePerpsJournal(value: unknown): PrivatePerpsJournal {
  if (!value || typeof value !== "object") throw new Error("INVALID_PRIVATE_PERPS_JOURNAL");
  const journal = value as PrivatePerpsJournal;
  if (
    journal.format !== "zkblast-private-perps-journal" || journal.version !== 1
      || !Array.isArray(journal.records) || journal.records.length > 128
  ) throw new Error("INVALID_PRIVATE_PERPS_JOURNAL");
  const commitments = new Set<string>();
  const records = journal.records.map((record) => {
    if (
      !record || !decimal.test(record.positionCommitment) || BigInt(record.positionCommitment) === 0n
        || !bytes32.test(record.marketId) || !decimal.test(record.marginRaw)
        || record.leverageBps < 10_000 || record.leverageBps > 100_000
        || !decimal.test(record.ownerSecret) || !decimal.test(record.ownerNonce)
        || (record.operation !== undefined && !["open", "close", "modify", "claim-liquidated"].includes(record.operation))
        || (record.generatedNoteCommitment !== undefined && !decimal.test(record.generatedNoteCommitment))
        || (record.replacesCommitment !== undefined && !decimal.test(record.replacesCommitment))
        || !["prepared", "open", "modifying", "closing", "closed", "liquidated"].includes(record.status)
        || (record.relayRequestId !== undefined && !bytes32.test(record.relayRequestId))
        || (record.transactionHash !== undefined && !bytes32.test(record.transactionHash))
    ) throw new Error("INVALID_PRIVATE_PERPS_RECORD");
    if (commitments.has(record.positionCommitment)) throw new Error("DUPLICATE_PRIVATE_PERPS_POSITION");
    commitments.add(record.positionCommitment);
    return { ...record };
  });
  return { format: journal.format, version: 1, records };
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
