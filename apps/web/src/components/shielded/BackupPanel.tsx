"use client";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { decryptNotes, download, encryptNotes, type Backup } from "@/lib/notecrypto";
import type { LocalNote } from "./DepositFlow";

export function BackupPanel({ notes, onRestore }: { notes: LocalNote[]; onRestore: (n: LocalNote[]) => void }) {
  const { toast } = useApp();
  const [exportPass, setExportPass] = useState("");
  const [file, setFile] = useState<Backup | null>(null);
  const [fileName, setFileName] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"exp" | "res" | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    setBusy("exp");
    try {
      download(`zkblast-notes-testnet-${new Date().toISOString().slice(0, 10)}.json`, await encryptNotes(notes, exportPass));
      toast({ kind: "success", title: `Exported ${notes.length} notes`, body: "Encrypted with your passphrase" });
    } finally { setBusy(null); }
  };

  const onFile = async (f?: File) => {
    setErr(""); setFile(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (!isBackup(parsed)) throw new Error("INVALID_BACKUP");
      setFile(parsed);
    } catch { setErr("This file is not a ZKBLAST note backup. Pick the .json file you downloaded when depositing."); }
  };

  const restore = async () => {
    if (!file) return;
    setBusy("res"); setErr("");
    try {
      const restored = await decryptNotes<LocalNote[]>(file, restorePass);
      onRestore(restored);
      toast({ kind: "success", title: `Restored ${restored.length} note${restored.length === 1 ? "" : "s"}` });
      setFile(null); setFileName(""); setRestorePass("");
    } catch { setErr("Wrong passphrase, or the file was changed. Check the passphrase and try again."); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid gap-8 md:grid-cols-2 md:gap-10">
      <section>
        <h3 className="wide text-[13.5px]">Export all notes</h3>
        <p className="mt-2 text-[14px] text-muted">Encrypts every note on this device into one file using PBKDF2 and AES-GCM in your browser.</p>
        <label htmlFor="exp-pass" className="mt-4 block text-[13px] text-faint">Passphrase (at least 10 characters)</label>
        <input id="exp-pass" type="password" autoComplete="new-password" value={exportPass} onChange={(e) => setExportPass(e.target.value)} className="mt-1.5 h-12 w-full rounded-sm border border-line bg-bg px-3 text-[16px] outline-none focus:border-lime/70 focus-visible:outline-none" />
        <Button className="mt-4 w-full" disabled={exportPass.length < 10 || !notes.length} loading={busy === "exp"} onClick={() => void exportAll()}><Download className="size-4" aria-hidden /> Export {notes.length} notes</Button>
      </section>
      <section>
        <h3 className="wide text-[13.5px]">Restore from backup</h3>
        <p className="mt-2 text-[14px] text-muted">Decrypted locally. Restored notes are merged with the ones already here.</p>
        <input ref={input} type="file" accept="application/json,.json" className="sr-only" id="restore-file" onChange={(e) => void onFile(e.target.files?.[0])} />
        <label htmlFor="restore-file" className="mt-4 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-sm border border-dashed border-line-strong text-[14px] text-muted transition-colors hover:border-lime/60 hover:text-fg">
          <Upload className="size-4" aria-hidden /> {fileName || "Choose backup file"}
        </label>
        <label htmlFor="res-pass" className="mt-4 block text-[13px] text-faint">Passphrase</label>
        <input id="res-pass" type="password" autoComplete="current-password" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void restore(); }} className="mt-1.5 h-12 w-full rounded-sm border border-line bg-bg px-3 text-[16px] outline-none focus:border-lime/70 focus-visible:outline-none" />
        {err && <p role="alert" className="mt-2 text-[13px] text-danger">{err}</p>}
        <Button variant="secondary" className="mt-4 w-full" disabled={!file || !restorePass} loading={busy === "res"} onClick={() => void restore()}>Restore notes</Button>
      </section>
    </div>
  );
}

function isBackup(value: unknown): value is Backup {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.format === "zkblast-note-backup"
    && candidate.version === 0
    && candidate.env === "testnet"
    && typeof candidate.salt === "string"
    && typeof candidate.iv === "string"
    && typeof candidate.ct === "string";
}
