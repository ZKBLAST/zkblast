"use client";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import { useRef, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { vault } from "@/data/shielded";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading } from "@/components/ui/Reveal";
import { easeOut } from "@/lib/motion";

const steps = [
  { title: "Deposit", body: "Approve the exact amount and deposit into the vault. The vault checks the balance it actually received, then emits the commitment.", public: "Your address, the asset and the amount are public." },
  { title: "Note", body: "Your browser created a secret and a nonce before the deposit. Hashed together with chain, vault, asset and amount they form the commitment. The note stays on your device; you export an encrypted backup.", public: "Only the commitment hash goes onchain." },
  { title: "Proof", body: "To withdraw, your browser proves the commitment sits in the tree under an accepted root, and reveals a nullifier. No prover service sees your secret.", public: "The proof reveals nothing about which leaf is yours." },
  { title: "Withdraw", body: "The contract checks the root, rejects a reused nullifier, marks it spent, then transfers to the recipient you chose.", public: "Recipient, amount and time are public. The link to your deposit is not." },
];

export function NoteJourney() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [step, setStep] = useState(0);
  const ring = useTransform(scrollYProgress, [0.5, 0.75], [0, 1]);
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  useMotionValueEvent(scrollYProgress, "change", (v) => setStep(Math.min(3, Math.floor(v * 4))));

  return (
    <section ref={ref} className="relative mt-32 md:mt-44" style={{ height: "380vh" }} aria-label="How a shielded note moves">
      <div className="sticky top-0 flex h-[100dvh] flex-col overflow-hidden pt-[var(--header-h)]">
        <div className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-4 sm:px-6">
          <Bay index="04" title="Note lifecycle" className="pt-8" />
          <div className="flex items-end justify-between gap-6 pt-5">
            <MaskHeading lines={["How a note moves"]} className="display text-[clamp(2rem,4.6vw,3.6rem)]" />
            <span className="num hidden text-sm text-faint sm:block">{String(step + 1).padStart(2, "0")} / 04</span>
          </div>
          <div className="mt-6 h-px w-full bg-line"><motion.div className="h-px bg-lime" style={{ width: bar }} /></div>

          <div className="grid flex-1 items-center gap-8 py-8 md:grid-cols-[minmax(0,26rem)_1fr] md:gap-16">
            <div>
              <ol className="mb-8 flex gap-2" aria-label="Steps">
                {steps.map((s, i) => (
                  <li key={s.title} className={`h-9 rounded-xs border px-3 font-mono text-[11.5px] uppercase tracking-[0.06em] leading-9 transition-colors duration-300 ${i === step ? "border-lime text-lime" : i < step ? "border-line-strong text-muted" : "border-line text-faint"}`} aria-current={i === step ? "step" : undefined}>
                    {s.title}
                  </li>
                ))}
              </ol>
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14, transition: { duration: 0.18 } }} transition={{ duration: 0.45, ease: easeOut }}>
                  <h3 className="display text-[clamp(2rem,4vw,3rem)]">{steps[step].title}</h3>
                  <p className="mt-4 font-mono text-[13.5px] leading-relaxed text-muted">{steps[step].body}</p>
                  <p className="mt-6 border-t border-line pt-4 font-mono text-[13px] text-faint">{steps[step].public}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="relative hidden h-full min-h-[340px] items-center justify-center md:flex">
              <AnimatePresence mode="wait">
                <motion.div key={step} className="w-full max-w-[520px]" initial={{ opacity: 0, scale: 0.96, rotateX: 12 }} animate={{ opacity: 1, scale: 1, rotateX: 0 }} exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18 } }} transition={{ duration: 0.55, ease: easeOut }} style={{ transformPerspective: 1000 }}>
                  {step === 0 && <DepositVisual />}
                  {step === 1 && <NoteVisual />}
                  {step === 2 && <ProofVisual ring={ring} />}
                  {step === 3 && <WithdrawVisual />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel ticks p-6 font-mono text-[13px]">{children}</div>;
}

function DepositVisual() {
  return (
    <Panel>
      <div className="flex items-center justify-between text-faint"><span>from 0x8a3F…5E21</span><span>public</span></div>
      <div className="my-8 flex items-center gap-4">
        <span className="display text-5xl text-fg">1,000</span>
        <span className="text-lg text-muted">USDC</span>
      </div>
      <div className="relative h-px bg-line">
        <motion.span className="absolute -top-[3px] size-[7px] rounded-full bg-lime" initial={{ left: "0%" }} animate={{ left: "100%" }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
      </div>
      <div className="mt-6 flex justify-between text-muted"><span>allowance: exactly 1,000</span><span className="inline-flex items-center gap-1 text-fg"><ArrowRight className="size-3" aria-hidden /> ZKBlastVault</span></div>
    </Panel>
  );
}

function NoteVisual() {
  return (
    <Panel>
      <div className="flex items-center justify-between"><span className="text-lime">zkblast-note-v0</span><span className="text-faint">this device only</span></div>
      <dl className="mt-6 space-y-3">
        {[["secret", 22], ["nonce", 14]].map(([k, n]) => (
          <div key={k as string} className="flex items-center gap-4">
            <dt className="w-16 text-faint">{k}</dt>
            <dd className="flex flex-1 gap-1">
              {Array.from({ length: n as number }).map((_, i) => (
                <motion.span key={i} className="h-3.5 flex-1 rounded-[1px] bg-fg" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.02, duration: 0.3 }} />
              ))}
            </dd>
          </div>
        ))}
        <div className="flex items-center gap-4 border-t border-line pt-3"><dt className="w-16 text-faint">commit</dt><dd className="inline-flex items-center gap-1 text-fg">0x2e10…7c4b <ArrowRight className="size-3 text-faint" aria-hidden /> <span className="text-faint">onchain</span></dd></div>
      </dl>
      <p className="mt-6 text-faint">encrypted backup: <span className="text-lime">saved</span></p>
    </Panel>
  );
}

function ProofVisual({ ring }: { ring: MotionValue<number> }) {
  return (
    <Panel>
      <div className="flex items-center gap-8">
        <svg viewBox="0 0 120 120" className="size-36 -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r="52" fill="none" stroke="#1d1e2e" strokeWidth="6" />
          <motion.circle cx="60" cy="60" r="52" fill="none" stroke="#dfe3ee" strokeWidth="6" strokeLinecap="round" style={{ pathLength: ring }} />
        </svg>
        <ul className="space-y-2 text-muted">
          {["sync root", "inclusion path", "witness", "prove", "verify locally"].map((s, i) => (
            <motion.li key={s} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.12 }}>
              <Check className="mr-1 inline size-3 text-lime" aria-hidden /> {s}
            </motion.li>
          ))}
        </ul>
      </div>
      <p className="mt-6 border-t border-line pt-4 text-faint">circuit {vault.circuit.id} · runs in your browser</p>
    </Panel>
  );
}

function WithdrawVisual() {
  return (
    <Panel>
      <div className="grid grid-cols-8 gap-1.5" aria-hidden>
        {Array.from({ length: 48 }).map((_, i) => (
          <motion.span key={i} className="aspect-square rounded-[2px] border border-line-strong bg-raised" initial={{ opacity: 0 }} animate={{ opacity: [0, 1], borderColor: ["#2e3047", "#dfe3ee", "#2e3047"] }} transition={{ delay: i * 0.025, duration: 0.9 }} />
        ))}
      </div>
      <p className="mt-5 text-muted">nullifier 0x7b02…e41a <span className="text-lime">spent</span></p>
      <p className="mt-1 inline-flex items-center gap-1 text-muted">1 WETH <ArrowRight className="size-3" aria-hidden /> 0x51cE…09aa <span className="text-faint">(fresh address)</span></p>
      <p className="mt-4 border-t border-line pt-4 text-faint">which square funded it is not revealed. anonymity set: {vault.anonymitySet.WETH} deposits</p>
    </Panel>
  );
}
