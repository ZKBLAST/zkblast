/* eslint-disable @typescript-eslint/no-unsafe-call -- preserved reference UI; runtime actions remain gated by the live app provider. */
"use client";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { TokenMark } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { sync, withdrawStages } from "@/data/shielded";
import { fmtAmount, cx, randomHex, shortHex } from "@/lib/format";
import type { LocalNote } from "./DepositFlow";
import { ProofProgress } from "./ProofProgress";

const slide = { initial: { opacity: 0, x: 24 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -24, transition: { duration: 0.15 } }, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } };
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

export function WithdrawFlow({ notes, onSpent }: { notes: LocalNote[]; onSpent: (id: string) => void }) {
  const { address, connect, adjust } = useApp();
  const unspent = notes.filter((n) => n.status === "unspent");
  const [source, setSource] = useState<"saved" | "paste">("saved");
  const [pick, setPick] = useState<string | null>(unspent[0]?.id ?? null);
  const [pasted, setPasted] = useState("");
  const [recipient, setRecipient] = useState("");
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState<"form" | "progress" | "done">("form");
  const [nullifier, setNullifier] = useState("");

  const pastedNote = useMemo<LocalNote | null>(() => {
    const m = pasted.trim().match(/^zkblast-note-v0-testnet-(WETH|USDC)-([0-9.]+)-([0-9a-f]{62})$/);
    if (!m) return null;
    return notes.find((n) => n.secret === m[3]) ?? { id: "pasted", asset: m[1] as "WETH" | "USDC", amount: +m[2], secret: m[3], commitment: "0x…", leafIndex: 0, createdAt: new Date().toISOString(), status: "unspent", backedUp: true };
  }, [pasted, notes]);

  const note = source === "saved" ? unspent.find((n) => n.id === pick) ?? null : pastedNote;
  const recipientOk = isAddr(recipient);
  const sameAsWallet = !!address && recipient.trim().toLowerCase() === address.toLowerCase();
  const ageHours = note ? (Date.now() - new Date(note.createdAt).getTime()) / 3_600_000 : 0;
  const spentAlready = note && note.status === "spent";

  const submit = () => { setTouched(true); if (!note || !recipientOk || spentAlready) return; setStep("progress"); };
  const finish = () => {
    if (!note) return;
    setNullifier(shortHex(randomHex(32)));
    if (note.id !== "pasted") onSpent(note.id);
    if (sameAsWallet) adjust(note.asset, note.amount);
    setStep("done");
  };

  return (
    <div className="min-h-[460px]">
      <AnimatePresence mode="wait">
        {step === "form" && (
          <motion.div key="form" {...slide}>
            <Segmented label="Note source" value={source} onChange={setSource} options={[{ value: "saved", label: "Notes on this device" }, { value: "paste", label: "Paste a note" }]} />

            {source === "saved" ? (
              unspent.length ? (
                <ul className="mt-4 space-y-2" role="radiogroup" aria-label="Choose a note">
                  {unspent.map((n) => (
                    <li key={n.id}>
                      <button role="radio" aria-checked={pick === n.id} onClick={() => setPick(n.id)}
                        className={cx("flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors cursor-pointer", pick === n.id ? "border-lime bg-lime/[0.06]" : "border-line hover:border-line-strong")}>
                        <TokenMark symbol={n.asset} size={28} />
                        <span className="flex-1">
                          <span className="num block text-[16px]">{fmtAmount(n.amount)} {n.asset}</span>
                          <span className="num block text-[12px] text-faint">leaf #{n.leafIndex.toLocaleString("en-US")} · {new Date(n.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        </span>
                        {pick === n.id && <Check className="size-4 text-lime" aria-hidden />}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-md border border-dashed border-line-strong p-6 text-center text-[14px] text-muted">No unspent notes on this device. Deposit first, or restore a backup.</p>
              )
            ) : (
              <div className="mt-4">
                <label htmlFor="paste" className="text-[13px] text-faint">Note string</label>
                <textarea id="paste" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} spellCheck={false} autoComplete="off" placeholder="zkblast-note-v0-testnet-…"
                  className="mt-1.5 w-full resize-none rounded-sm border border-line bg-bg p-3 font-mono text-[14px] outline-none focus:border-lime/70 focus-visible:outline-none" />
                {pasted && !pastedNote && <p className="mt-1 text-[12px] text-danger">This is not a valid testnet note. It should start with zkblast-note-v0-testnet-.</p>}
                {pastedNote && <p className="mt-1 text-[12px] text-lime">Valid note: {fmtAmount(pastedNote.amount)} {pastedNote.asset}{pastedNote.status === "spent" && " (already spent)"}</p>}
              </div>
            )}

            <label htmlFor="recipient" className="mt-6 block text-[13px] text-faint">Recipient address</label>
            <div className="mt-1.5 flex gap-2">
              <input id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} onBlur={() => setTouched(true)} spellCheck={false} autoComplete="off" placeholder="0x…"
                aria-invalid={touched && !recipientOk ? true : undefined} aria-describedby="recipient-hint"
                className={cx("num h-12 min-w-0 flex-1 rounded-sm border bg-bg px-3 text-[16px] outline-none sm:text-[14px]", touched && recipient && !recipientOk ? "border-danger/70" : "border-line focus:border-lime/70")} />
              {address && <Button variant="secondary" className="h-12 shrink-0" onClick={() => setRecipient(address)}>Use mine</Button>}
            </div>
            <p id="recipient-hint" className={cx("mt-1.5 text-[12px]", touched && recipient && !recipientOk ? "text-danger" : "text-faint")}>
              {touched && recipient && !recipientOk ? "Enter a 0x address with 40 hex characters." : "A fresh address that has never touched your deposit wallet gives the most privacy."}
            </p>

            {(sameAsWallet || (note && ageHours < 24)) && (
              <div className="mt-4 space-y-2 rounded-md border border-warn/50 bg-warn/[0.06] p-4 text-[13px]">
                <p className="flex items-center gap-2 font-semibold text-warn"><AlertTriangle className="size-4" aria-hidden /> This withdrawal is easy to link</p>
                {sameAsWallet && <p className="text-muted">You are withdrawing to the wallet that is connected now. Anyone can connect that address to your deposits.</p>}
                {note && ageHours < 24 && <p className="text-muted">This note is less than a day old. Withdrawing right after depositing narrows who it could be.</p>}
              </div>
            )}

            <dl className="mt-6 space-y-2 border-t border-line pt-4 text-[13px]">
              <div className="flex justify-between"><dt className="text-faint">Root to prove against</dt><dd className="num">{sync.chainRoot}</dd></div>
              <div className="flex justify-between"><dt className="text-faint">Relayer</dt><dd>None, you pay gas from the recipient</dd></div>
            </dl>
            <Button size="lg" className="mt-5 w-full" disabled={!note || !!spentAlready} onClick={() => (!address ? connect() : submit())}>
              {!address ? "Connect wallet" : !note ? "Choose a note" : spentAlready ? "Note already spent" : `Generate proof and withdraw ${fmtAmount(note.amount)} ${note.asset}`}
            </Button>
          </motion.div>
        )}

        {step === "progress" && (
          <motion.div key="progress" {...slide}>
            <ProofProgress stages={withdrawStages} running onDone={finish} />
            <Button variant="ghost" className="mt-5" onClick={() => setStep("form")}>Cancel before submitting</Button>
          </motion.div>
        )}

        {step === "done" && note && (
          <motion.div key="done" {...slide}>
            <div className="text-center">
              <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="mx-auto mt-4 grid size-20 place-items-center rounded-full border-2 border-lime">
                <Check className="size-9 text-lime" aria-hidden />
              </motion.div>
              <h3 className="display mt-6 text-[32px]">Withdrawn</h3>
            </div>
            <dl className="mt-6 space-y-2 rounded-md bg-bg p-4 text-[13px]">
              <div className="flex justify-between gap-4"><dt className="text-faint">Amount</dt><dd className="num">{fmtAmount(note.amount)} {note.asset}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-faint">Recipient</dt><dd className="num">{shortHex(recipient.trim(), 6)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-faint">Nullifier</dt><dd className="num">{nullifier} <span className="text-lime">spent</span></dd></div>
              <div className="flex justify-between gap-4"><dt className="text-faint">Proof</dt><dd>Simulated, not verified onchain</dd></div>
            </dl>
            <Button variant="secondary" className="mt-6 w-full" onClick={() => { setStep("form"); setRecipient(""); setPasted(""); setTouched(false); setPick(unspent.find((n) => n.id !== note.id)?.id ?? null); }}>Withdraw another note</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
