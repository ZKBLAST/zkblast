import type { PrivateJournalV2 } from "./private-v2-journal";

export const PRIVATE_V2_SUMMARY_EVENT = "zkblast:private-v2-summary";

export type PrivateV2SessionSummary = Readonly<{
  tokenNotes: number;
  lpNotes: number;
  activeIntents: number;
  transactions: number;
}>;

export function privateV2SessionSummary(
  journal: PrivateJournalV2,
): PrivateV2SessionSummary {
  return {
    tokenNotes: journal.notes.filter((note) => note.resource.kind === "token")
      .length,
    lpNotes: journal.notes.filter((note) => note.resource.kind === "lp").length,
    activeIntents: journal.intents.filter(
      (intent) => !journal.archivedIntents.includes(intent.id),
    ).length,
    transactions: journal.transactions.length,
  };
}

export function publishPrivateV2SessionSummary(
  journal: PrivateJournalV2 | null,
) {
  window.dispatchEvent(
    new CustomEvent<PrivateV2SessionSummary | null>(PRIVATE_V2_SUMMARY_EVENT, {
      detail: journal ? privateV2SessionSummary(journal) : null,
    }),
  );
}
