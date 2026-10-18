"use client";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
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
  const [busy, setBusy] = useState(false);

  const exportAll = async () => {
    setBusy(true);
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
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h3 className="wide text-[13.5px]">Export encrypted notes</h3>
        <p className="mt-2 text-sm text-muted">
          The passphrase and plaintext notes never leave this browser.
        </p>
        <input
          aria-label="Export passphrase"
          type="password"
          autoComplete="new-password"
          value={exportPassphrase}
          onChange={(event) => setExportPassphrase(event.target.value)}
          className="mt-4 h-12 w-full rounded-sm border border-line bg-bg px-3"
        />
        <Button
          className="mt-4 w-full"
          disabled={exportPassphrase.length < 12 || !notes.length}
          loading={busy}
          onClick={() => void exportAll()}
        >
          <Download className="size-4" /> Export {notes.length}
        </Button>
      </section>
      <section>
        <h3 className="wide text-[13.5px]">Restore validated backup</h3>
        <p className="mt-2 text-sm text-muted">
          Network and vault bindings are checked before any note is accepted.
        </p>
        <label className="mt-4 flex h-12 cursor-pointer items-center justify-center gap-2 border border-dashed border-line-strong">
          <Upload className="size-4" />
          {fileName || "Choose backup"}
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
        </label>
        <input
          aria-label="Restore passphrase"
          type="password"
          autoComplete="current-password"
          value={restorePassphrase}
          onChange={(event) => setRestorePassphrase(event.target.value)}
          className="mt-4 h-12 w-full rounded-sm border border-line bg-bg px-3"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          variant="secondary"
          className="mt-4 w-full"
          disabled={!backup || restorePassphrase.length < 12}
          loading={busy}
          onClick={() => void restore()}
        >
          Restore notes
        </Button>
      </section>
    </div>
  );
}
