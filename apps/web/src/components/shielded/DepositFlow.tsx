/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- preserved reference UI; runtime actions remain gated by the live app provider. */
"use client";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Copy, Download, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { TokenMark } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { depositStages, shieldedWarnings, vault, type ShieldedNote } from "@/data/shielded";
import { fmtAmount, fmtUsd, cx, randomHex, shortHex } from "@/lib/format";
import { download, encryptNotes } from "@/lib/notecrypto";
import { tokenBySymbol } from "@/data/tokens";
import { ProofProgress } from "./ProofProgress";

type Asset = "WETH" | "USDC";
export type LocalNote = ShieldedNote & { secret?: string };

const slide = { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24, transition: { duration: 0.15 } }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } };

export function DepositFlow({ onCreated, nextLeaf }: { onCreated: (n: LocalNote) => void; nextLeaf: number }) {
  const { address, balances, connect, adjust, toast } = useApp();
  const [step, setStep] = useState<"amount" | "backup" | "confirm" | "progress" | "done">("amount");
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState<number>(vault.denominations.USDC[1]);
  const [note, setNote] = useState<LocalNote | null>(null);
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [acks, setAcks] = useState<boolean[]>(shieldedWarnings.map(() => false));
  const [busy, setBusy] = useState(false);

  const bal = balances[asset] ?? 0;
  const over = !!address && amount > bal;
  const noteString = note ? `zkblast-note-v0-testnet-${note.asset}-${note.amount}-${note.secret}` : "";

  const start = () => {
    const secret = randomHex(31).slice(2);
    setNote({ id: `note-${Date.now().toString(36)}`, asset, amount, secret, commitment: shortHex(randomHex(32)), leafIndex: nextLeaf, createdAt: new Date().toISOString(), status: "pending", backedUp: false });
    setStep("backup");
  };

  const saveBackup = async () => {
    if (!note || pass.length < 10) return;
    setBusy(true);
    try {
      const file = await encryptNotes([{ ...note }], pass);
      download(`zkblast-note-${note.asset}-${note.amount}-testnet.json`, file);
      setSaved(true);
      setNote({ ...note, backedUp: true });
      toast({ kind: "success", title: "Encrypted backup saved", body: "Keep the file and the passphrase separately." });
    } finally { setBusy(false); }
  };

  const finish = () => {
    if (!note) return;
    adjust(asset, -amount);
    onCreated({ ...note, status: "unspent" });
    setStep("done");
  };

  const reset = () => { setStep("amount"); setNote(null); setPass(""); setSaved(false); setAcks(shieldedWarnings.map(() => false)); };

  return (
    <div className="min-h-[460px]">
      <AnimatePresence mode="wait">
        {step === "amount" && (
          <motion.div key="amount" {...slide}>
            <p className="text-[13px] text-faint">Asset</p>
            <div className="mt-2">
              <Segmented label="Asset" value={asset} onChange={(a) => { setAsset(a); setAmount(vault.denominations[a][1]); }} options={vault.allowlist.map((a) => ({ value: a, label: a }))} />
            </div>
            <p className="mt-6 text-[13px] text-faint">Amount</p>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Deposit amount">
              {vault.denominations[asset].map((d) => (
                <button key={d} role="radio" aria-checked={amount === d} onClick={() => setAmount(d)}
                  className={cx("rounded-md border px-3 py-4 text-left transition-colors cursor-pointer", amount === d ? "border-lime bg-lime/[0.06]" : "border-line hover:border-line-strong")}>
                  <span className="num block text-[22px]">{fmtAmount(d)}</span>
                  <span className="num block text-[12px] text-faint">{fmtUsd(d * tokenBySymbol(asset).priceUsd)}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-faint">Fixed amounts keep your deposit in a larger anonymity set. Current {asset} set (simulated): <span className="num text-fg">{vault.anonymitySet[asset]}</span> deposits.</p>
            {address && <p className={cx("num mt-4 text-[13px]", over ? "text-danger" : "text-faint")}>Wallet balance {fmtAmount(bal)} {asset}{over && " · not enough for this amount"}</p>}
            <Button size="lg" className="mt-6 w-full" disabled={!!address && over} onClick={() => (!address ? connect() : start())}>
              {!address ? "Connect wallet" : over ? `Not enough ${asset}` : "Create note"}
            </Button>
            <p className="mt-3 text-center text-[12px] text-faint">The note is generated in this browser before anything is sent.</p>
          </motion.div>
        )}

        {step === "backup" && note && (
          <motion.div key="backup" {...slide}>
            <h3 className="wide text-[13.5px]">Back up your note</h3>
            <p className="mt-2 text-[14px] text-muted">This string is the only way to withdraw. Encrypt it with a passphrase and keep the file somewhere safe.</p>
            <div className="mt-5 rounded-md border border-line bg-bg p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[12px] text-faint">note · testnet</span>
                <div className="flex gap-1">
                  <button onClick={() => setShow((s) => !s)} aria-label={show ? "Hide note" : "Show note"} className="grid size-9 place-items-center rounded-sm text-muted hover:bg-raised hover:text-fg cursor-pointer">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
                  <button onClick={() => { void navigator.clipboard?.writeText(noteString); toast({ kind: "info", title: "Note copied", body: "Clear your clipboard after storing it." }); }} aria-label="Copy note" className="grid size-9 place-items-center rounded-sm text-muted hover:bg-raised hover:text-fg cursor-pointer"><Copy className="size-4" /></button>
                </div>
              </div>
              <p className={cx("mt-2 break-all font-mono text-[13px] leading-relaxed transition-[filter] duration-200", show ? "text-fg" : "select-none text-muted blur-[5px]")}>{noteString}</p>
            </div>
            <label htmlFor="pass" className="mt-5 block text-[13px] text-faint">Backup passphrase (at least 10 characters)</label>
            <input id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password"
              className="mt-1.5 h-12 w-full rounded-sm border border-line bg-bg px-3 text-[16px] outline-none focus:border-lime/70 focus-visible:outline-none" />
            {pass.length > 0 && pass.length < 10 && <p className="mt-1.5 text-[12px] text-warn">{10 - pass.length} more characters.</p>}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button variant={saved ? "secondary" : "primary"} className="flex-1" loading={busy} disabled={pass.length < 10} onClick={() => void saveBackup()}>
                <Download className="size-4" aria-hidden /> {saved ? "Download again" : "Download encrypted backup"}
              </Button>
              <Button variant="secondary" className="flex-1" disabled={!saved} onClick={() => setStep("confirm")}>Continue</Button>
            </div>
            <button onClick={reset} className="mt-4 text-[13px] text-faint hover:text-fg cursor-pointer">Cancel and discard this note</button>
          </motion.div>
        )}

        {step === "confirm" && note && (
          <motion.div key="confirm" {...slide}>
            <div className="flex items-start gap-3 rounded-md border border-warn/50 bg-warn/[0.06] p-4">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
              <div>
                <p className="font-semibold text-warn">Read before depositing</p>
                <p className="mt-1 text-[13px] text-muted">A deposit cannot be undone, and a lost note cannot be recovered.</p>
              </div>
            </div>
            <fieldset className="mt-5 space-y-3">
              <legend className="sr-only">Acknowledge each warning</legend>
              {shieldedWarnings.map((w, i) => (
                <label key={i} className="flex cursor-pointer items-start gap-3 rounded-sm p-1 text-[14px]">
                  <input type="checkbox" checked={acks[i]} onChange={(e) => setAcks((a) => a.map((x, k) => (k === i ? e.target.checked : x)))} className="mt-1 size-4 shrink-0 accent-[#dfe3ee]" />
                  <span className={acks[i] ? "text-fg" : "text-muted"}>{w}</span>
                </label>
              ))}
            </fieldset>
            <dl className="mt-5 space-y-2 border-t border-line pt-4 text-[14px]">
              <div className="flex justify-between"><dt className="text-faint">Deposit</dt><dd className="num inline-flex items-center gap-2"><TokenMark symbol={note.asset} size={18} />{fmtAmount(note.amount)} {note.asset}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Commitment</dt><dd className="num">{note.commitment}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Backup</dt><dd className="text-lime">Encrypted file saved</dd></div>
            </dl>
            <Button size="lg" className="mt-6 w-full" disabled={!acks.every(Boolean)} onClick={() => setStep("progress")}>
              Deposit {fmtAmount(note.amount)} {note.asset}
            </Button>
          </motion.div>
        )}

        {step === "progress" && (
          <motion.div key="progress" {...slide}>
            <ProofProgress stages={depositStages} running onDone={finish} />
          </motion.div>
        )}

        {step === "done" && note && (
          <motion.div key="done" {...slide} className="text-center">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="mx-auto mt-6 grid size-20 place-items-center rounded-full border-2 border-lime">
              <svg viewBox="0 0 24 24" className="size-9 text-lime" aria-hidden><motion.path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2, duration: 0.5 }} /></svg>
            </motion.div>
            <h3 className="display mt-6 text-[32px]">Note created</h3>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-muted">{fmtAmount(note.amount)} {note.asset} is in the vault as leaf #{note.leafIndex.toLocaleString("en-US")}. Waiting longer before withdrawing makes it harder to link.</p>
            <p className="mt-3 font-mono text-[12px] text-faint">simulated · testnet · nothing was sent onchain</p>
            <Button variant="secondary" className="mt-6" onClick={reset}>Make another deposit</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
