"use client";
import { Download, FileJson, Upload } from "lucide-react";
import { useId, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import {
  decryptNotes,
  download,
  encryptNotes,
  isBackup,
  type Backup,
  type NoteEnvironment,
  type ShieldedNoteV1,
} from "@/lib/notecrypto";

type Props = Readonly<{
  notes: readonly ShieldedNoteV1[];
  environment: NoteEnvironment;
  chainId: number;
  vaultAddress: string;
  onRestore: (notes: readonly ShieldedNoteV1[]) => void;
}>;

export function BackupPanel({
  notes,
  environment,
  chainId,
  vaultAddress,
  onRestore,
}: Props) {
  const { toast } = useApp();
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [backup, setBackup] = useState<Backup | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);
  const id = useId();
  const inputClass =
    "h-12 w-full min-w-0 border border-line bg-bg px-3 text-sm placeholder:text-faint focus:border-line-strong disabled:opacity-50";

  const exportAll = async () => {
    setBusy("export");
    setError("");
    try {
      download(
        `zkblast-notes-${environment}-${chainId}.json`,
        await encryptNotes(notes, exportPassphrase, environment, chainId),
      );
      toast({
        kind: "success",
        title: `Encrypted ${notes.length} note${notes.length === 1 ? "" : "s"}`,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "BACKUP_FAILED");
    } finally {
      setBusy(null);
    }
  };

  const selectFile = async (file?: File) => {
    setError("");
    setBackup(null);
    if (!file) return;
    setFileName(file.name);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isBackup(parsed)) throw new Error("INVALID_BACKUP");
      setBackup(parsed);
    } catch {
      setError("The selected file is not a valid encrypted ZKBLAST v1 backup.");
    }
  };

  const restore = async () => {
    if (!backup) return;
    setBusy("restore");
    setError("");
    try {
      const restored = await decryptNotes(backup, restorePassphrase, {
        environment,
        chainId,
      });
      if (
        restored.some(
          (note) =>
            note.vaultAddress.toLowerCase() !== vaultAddress.toLowerCase(),
        )
      )
        throw new Error("NOTE_VAULT_MISMATCH");
      onRestore(restored);
      toast({
        kind: "success",
        title: `Restored ${restored.length} validated note${restored.length === 1 ? "" : "s"}`,
      });
      setBackup(null);
      setFileName("");
      setRestorePassphrase("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "RESTORE_FAILED");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 gap-6 @2xl:grid-cols-2">
        <section
          aria-labelledby={`${id}-export-title`}
          className="flex min-w-0 flex-col gap-6 border border-line bg-bg/40 p-4 sm:p-5"
        >
          <div className="space-y-3">
            <Download className="size-5 text-muted" aria-hidden />
            <h3
              id={`${id}-export-title`}
              className="text-base font-medium leading-6"
            >
              Export encrypted notes
            </h3>
            <p className="text-sm leading-6 text-muted">
              Save an encrypted copy of your notes. Your passphrase and
              plaintext notes stay in this browser.
            </p>
          </div>
          <div className="space-y-2">
            <label
              htmlFor={`${id}-export-passphrase`}
              className="block text-xs text-muted"
            >
              Create a backup passphrase
            </label>
            <input
              id={`${id}-export-passphrase`}
              aria-label="Export passphrase"
              type="password"
              autoComplete="new-password"
              value={exportPassphrase}
              onChange={(event) => setExportPassphrase(event.target.value)}
              placeholder="At least 12 characters"
              disabled={busy !== null}
              className={inputClass}
            />
            <p className="text-xs leading-5 text-faint">
              Keep the backup file and passphrase separately.
            </p>
          </div>
          {!notes.length && (
            <p className="text-xs leading-5 text-muted">
              No notes to export yet. Deposit or restore a note first.
            </p>
          )}
          <Button
            className="mt-auto w-full whitespace-normal"
            disabled={
              busy !== null || exportPassphrase.length < 12 || !notes.length
            }
            loading={busy === "export"}
            onClick={() => void exportAll()}
          >
            <Download className="size-4 shrink-0" aria-hidden /> Download backup
            {notes.length ? ` (${notes.length})` : ""}
          </Button>
        </section>
        <section
          aria-labelledby={`${id}-restore-title`}
          className="flex min-w-0 flex-col gap-6 border border-line bg-bg/40 p-4 sm:p-5"
        >
          <div className="space-y-3">
            <Upload className="size-5 text-muted" aria-hidden />
            <h3
              id={`${id}-restore-title`}
              className="text-base font-medium leading-6"
            >
              Restore validated backup
            </h3>
            <p className="text-sm leading-6 text-muted">
              Load your encrypted backup. Its network and vault are checked
              before notes are restored.
            </p>
          </div>
          <div className="space-y-2">
            <span className="block text-xs text-muted">
              Encrypted backup file
            </span>
            <label className="flex min-h-24 min-w-0 cursor-pointer items-center gap-3 border border-dashed border-line-strong px-3 py-4 transition-colors hover:bg-raised focus-within:border-lime">
              <FileJson className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0">
                <span className="block break-all text-sm">
                  {fileName || "Choose backup"}
                </span>
                <span className="mt-1 block text-xs text-faint">
                  Encrypted ZKBLAST JSON file
                </span>
              </span>
              <input
                aria-label="Choose encrypted backup file"
                type="file"
                accept="application/json,.json"
                className="sr-only"
                disabled={busy !== null}
                onChange={(event) => void selectFile(event.target.files?.[0])}
              />
            </label>
          </div>
          <div className="space-y-2">
            <label
              htmlFor={`${id}-restore-passphrase`}
              className="block text-xs text-muted"
            >
              Backup passphrase
            </label>
            <input
              id={`${id}-restore-passphrase`}
              aria-label="Restore passphrase"
              type="password"
              autoComplete="current-password"
              value={restorePassphrase}
              onChange={(event) => setRestorePassphrase(event.target.value)}
              placeholder="Enter your backup passphrase"
              disabled={busy !== null}
              className={inputClass}
            />
          </div>
          <Button
            variant="secondary"
            className="mt-auto w-full whitespace-normal"
            disabled={busy !== null || !backup || restorePassphrase.length < 12}
            loading={busy === "restore"}
            onClick={() => void restore()}
          >
            <Upload className="size-4 shrink-0" aria-hidden /> Restore notes
          </Button>
        </section>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-5 break-words border border-danger/30 p-3 text-sm leading-6 text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
