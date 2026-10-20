"use client";
import { AlertTriangle, Download } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { createShieldedNote } from "@/lib/note-circuit";
import {
  download,
  encryptNotes,
  storeEncryptedNotes,
  type NoteEnvironment,
  type ShieldedNoteV1,
} from "@/lib/notecrypto";

export type VaultAsset = Readonly<{
  symbol: string;
  address: `0x${string}`;
  denominationRaw: string;
  decimals: number;
}>;
/** Temporary compatibility shape for the preserved withdrawal reference UI; Slice 13 replaces it with ShieldedNoteV1. */
export type LocalNote = Readonly<{
  id: string;
  asset: "WETH" | "USDC";
  amount: number;
  secret?: string;
  commitment: string;
  leafIndex: number;
  createdAt: string;
  status: "pending" | "unspent" | "spent";
  backedUp: boolean;
}>;
type Props = Readonly<{
  environment: NoteEnvironment;
  chainId: number;
  vaultAddress: `0x${string}`;
  treeVersion: number;
  assets: readonly VaultAsset[];
  onSubmit: (note: ShieldedNoteV1) => Promise<ShieldedNoteV1>;
  onCreated: (note: ShieldedNoteV1) => void;
}>;

const formatAmount = (asset: VaultAsset): string => {
  const scale = 10n ** BigInt(asset.decimals);
  const amount = BigInt(asset.denominationRaw);
  return `${amount / scale}${amount % scale ? `.${(amount % scale).toString().padStart(asset.decimals, "0").replace(/0+$/u, "")}` : ""}`;
};

export function DepositFlow({
  environment,
  chainId,
  vaultAddress,
  treeVersion,
  assets,
  onSubmit,
  onCreated,
}: Props) {
  const { address, connect, toast, config } = useApp();
  const [assetAddress, setAssetAddress] = useState(assets[0]?.address ?? "");
  const [note, setNote] = useState<ShieldedNoteV1 | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [backupSaved, setBackupSaved] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"prepare" | "backup" | "submit" | null>(
    null,
  );
  const [error, setError] = useState("");
  const asset = assets.find((item) => item.address === assetAddress) ?? null;

  const prepare = async () => {
    if (!asset) return;
    setBusy("prepare");
    setError("");
    try {
      setNote(
        await createShieldedNote({
          environment,
          chainId,
          vaultAddress,
          treeVersion,
          assetAddress: asset.address,
          amountRaw: asset.denominationRaw,
        }),
      );
      setBackupSaved(false);
      setAcknowledged(false);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "NOTE_PREPARATION_FAILED",
      );
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    if (!note) return;
    setBusy("backup");
    setError("");
    try {
      const encrypted = await encryptNotes(
        [note],
        passphrase,
        environment,
        chainId,
      );
      download(
        `zkblast-note-${environment}-${chainId}-${note.commitment.slice(0, 10)}.json`,
        encrypted,
      );
      setBackupSaved(true);
      toast({
        kind: "success",
        title: "Encrypted note backup downloaded",
        body: "Store the file and passphrase separately.",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "BACKUP_FAILED");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!note || !backupSaved || !acknowledged) return;
    setBusy("submit");
    setError("");
    try {
      const submitted = await onSubmit(note);
      await storeEncryptedNotes(window.localStorage, [submitted], passphrase);
      onCreated(submitted);
      setNote(submitted);
      setBackupSaved(false);
      toast({ kind: "success", title: "Commitment deposit confirmed" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "DEPOSIT_FAILED");
    } finally {
      setBusy(null);
    }
  };

  if (!assets.length)
    return (
      <div className="panel p-6 text-sm text-muted">
        No governance-approved vault asset is configured for this network.
      </div>
    );
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-faint">Governance-approved denomination</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {assets.map((item) => (
            <button
              key={item.address}
              onClick={() => {
                setAssetAddress(item.address);
                setNote(null);
                setBackupSaved(false);
              }}
              className={`cursor-pointer border p-4 text-left ${assetAddress === item.address ? "border-lime bg-lime/[0.06]" : "border-line"}`}
            >
              <span className="num text-xl">
                {formatAmount(item)} {item.symbol}
              </span>
              <span className="mt-1 block truncate font-mono text-[10px] text-faint">
                {item.address}
              </span>
            </button>
          ))}
        </div>
      </div>
      {!note && (
        <Button
          size="lg"
          className="w-full"
          loading={busy === "prepare"}
          onClick={() => (address ? void prepare() : connect())}
        >
          {address ? "Generate note locally" : "Connect wallet"}
        </Button>
      )}
      {note && (
        <section className="panel ticks space-y-5 p-5">
          <div>
            <p className="label">Prepared commitment</p>
            <p className="mt-2 break-all font-mono text-xs text-fg">
              {note.commitment}
            </p>
          </div>
          <p className="text-sm text-muted">
            The secret and nonce exist only inside the encrypted backup. They
            are never submitted to ZKBLAST services.
          </p>
          <input
            aria-label="Backup passphrase"
            type="password"
            autoComplete="new-password"
            placeholder="Backup passphrase, at least 12 characters"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            className="h-12 w-full rounded-sm border border-line bg-bg px-3"
          />
          <Button
            className="w-full"
            loading={busy === "backup"}
            disabled={passphrase.length < 12}
            onClick={() => void backup()}
          >
            <Download className="size-4" />{" "}
            {backupSaved
              ? "Download backup again"
              : "Download encrypted backup"}
          </Button>
          <label className="flex items-start gap-3 border border-warn/40 bg-warn/[0.05] p-4 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              <strong className="flex items-center gap-2 text-warn">
                <AlertTriangle className="size-4" />
                Irreversible-loss warning
              </strong>
              <span className="mt-1 block text-muted">
                I understand that losing both the encrypted backup and its
                passphrase permanently removes my ability to withdraw.
                {environment === "mainnet" &&
                  config?.shielded?.launchMode ===
                    "experimental-single-operator" &&
                  " I also accept that this experimental single-operator setup has no independent audit or ceremony assurance and that I may lose the deposited funds."}
              </span>
            </span>
          </label>
          <Button
            size="lg"
            className="w-full"
            loading={busy === "submit"}
            disabled={
              !backupSaved || !acknowledged || note.status !== "prepared"
            }
            onClick={() => void submit()}
          >
            {note.status === "prepared"
              ? "Approve exact amount and deposit"
              : "Deposit confirmed"}
          </Button>
          {note.status === "unspent" && (
            <p role="status" className="text-sm text-warn">
              Download the updated encrypted backup now. It includes the
              confirmed leaf index needed by this withdrawal interface. Keep it
              before refreshing or closing the page.
            </p>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
