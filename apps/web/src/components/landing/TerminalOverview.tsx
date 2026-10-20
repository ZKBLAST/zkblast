"use client";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading } from "@/components/ui/Reveal";
import { seeded } from "@/data/pools";
import {
  nullifierBaseline,
  pipelineBaseline,
  type Intent,
} from "@/data/terminal";
import { cx } from "@/lib/format";
import { useProtocolData } from "@/lib/use-protocol-data";

/* One clock drives every panel, and only while the section is on screen. */
function useTick(active: boolean, ms = 850) {
  const reduce = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active || reduce) return;
    const id = setInterval(() => setT((v) => v + 1), ms);
    return () => clearInterval(id);
  }, [active, reduce, ms]);
  return t;
}

function Panel({ title, caption, className, children, inner }: { title: string; caption?: string; className?: string; children: React.ReactNode; inner?: string }) {
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div className="panel flex min-h-0 flex-1 flex-col p-2">
        <p className="px-1.5 pb-2 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg/75">{title}</p>
        <div className={cx("panel-inset min-h-0 flex-1 overflow-hidden", inner)}>{children}</div>
      </div>
      {caption && <p className="pt-2 text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{caption}</p>}
    </div>
  );
}

const Fins = ({ className }: { className?: string }) => <div aria-hidden className={cx("barcode mx-auto w-20 opacity-70", className)} />;

/* ── INCOMING_TX: a wall of slots; each tick lights the cells new intents land in. */
function IncomingGrid({ t }: { t: number }) {
  const cells = 22 * 16;
  const lit = useMemo(() => {
    const r = seeded(500 + t);
    const m = new Map<number, "public" | "shielded">();
    for (let i = 0; i < 22; i++) m.set((r() * cells) | 0, r() < 0.3 ? "shielded" : "public");
    return m;
  }, [t, cells]);
  return (
    <div className="grid h-full grid-cols-[repeat(22,minmax(0,1fr))] grid-rows-[repeat(16,minmax(0,1fr))] gap-[3px] p-2.5">
      {Array.from({ length: cells }, (_, i) => {
        const l = lit.get(i);
        return <span key={i} className={cx("min-h-[6px] rounded-[1px] transition-colors duration-500", l === "shielded" ? "bg-lime/80" : l === "public" ? "bg-steel/70" : "bg-steel/[0.12]")} />;
      })}
    </div>
  );
}

/* ── TX_QUEUE: intents waiting, newest on top, lane-coloured. */
function Queue({ items }: { items: Intent[] }) {
  return (
    <ul className="space-y-[3px] p-2.5">
      <AnimatePresence initial={false}>
        {items.slice(0, 9).map((it) => (
          <motion.li key={it.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}
            className={cx("grid grid-cols-[52px_1fr] items-center gap-2 px-2 py-1.5 font-mono text-[10px]", it.lane === "shielded" ? "bg-lime/[0.07]" : "bg-steel/[0.07]")}>
            <span className={it.lane === "shielded" ? "text-lime" : "text-steel"}>{it.kind}</span>
            <span className="truncate text-muted">{it.lane === "shielded" ? it.amount : it.pair}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/* ── ROUTER: public swaps matched to a pool; shielded intents bypass it. */
function Router({ items }: { items: Intent[] }) {
  const pub = items.filter((i) => i.lane === "public").slice(0, 8);
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 divide-y divide-line/70">
        <AnimatePresence initial={false}>
          {pub.map((it, i) => (
            <motion.li key={it.id} layout initial={{ opacity: 0, backgroundColor: "rgba(174,188,229,0.08)" }} animate={{ opacity: 1 - i * 0.08, backgroundColor: "rgba(174,188,229,0)" }} exit={{ opacity: 0 }}
              className="grid grid-cols-[48px_1fr_auto] items-center gap-2 px-3 py-2 font-mono text-[10.5px]">
              <span className={it.kind === "SWAP" ? "text-lime" : "text-steel"}>{it.kind}</span>
              <span className="truncate text-fg/85">{it.amount}</span>
              <span className="text-[9.5px] uppercase text-faint">{it.route}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="flex items-center justify-between border-t border-line px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        <span>Best route · DLMM ↔ DAMM</span><span className="text-lime">live</span>
      </div>
    </div>
  );
}

/* ── SLIPPAGE GUARD: a live bin silhouette plus a bank of check cells. */
function Guard({ t }: { t: number }) {
  const bars = useMemo(() => {
    const r = seeded(77 + (t % 40));
    return Array.from({ length: 34 }, (_, i) => Math.max(0.08, Math.exp(-((i - 17 + Math.sin(t / 3) * 3) ** 2) / 60) * (0.6 + r() * 0.4)));
  }, [t]);
  const checks = ["MAX IN", "MIN OUT", "DEADLINE", "PRICE IMPACT", "BIN RANGE", "FEE TIER"];
  return (
    <div className="flex h-full flex-col gap-2 p-2.5">
      <div className="flex h-16 items-end gap-[2px] border border-line bg-[#07070d] px-1.5 pb-1">
        {bars.map((h, i) => (
          <span key={i} className={cx("flex-1 transition-[height] duration-700", i === 17 ? "bg-lime" : i < 17 ? "bg-[#3d4566]" : "bg-steel/60")} style={{ height: `${h * 100}%` }} />
        ))}
      </div>
      <div className="grid flex-1 grid-cols-3 gap-[3px]">
        {checks.map((c, i) => {
          const on = (t + i) % 6 !== 0;
          return (
            <span key={c} className={cx("grid place-items-center border px-1 text-center font-mono text-[8.5px] uppercase leading-tight tracking-[0.06em] transition-colors duration-300", on ? "border-line-strong bg-raised text-fg/80" : "border-lime/50 bg-lime/10 text-lime")}>
              {c}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ── EXECUTOR: settlement noise, the bytes of each batch being assembled. */
function Executor({ t }: { t: number }) {
  const rows = useMemo(() => {
    const r = seeded(31 + t);
    return Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => (r() < 0.5 ? "0" : "1")).join(""));
  }, [t]);
  const dashes = useMemo(() => {
    const r = seeded(1200 + t);
    return Array.from({ length: 16 }, () => Array.from({ length: 4 }, () => 18 + ((r() * 60) | 0)));
  }, [t]);
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-2 p-2.5">
      <div className="flex flex-col justify-between py-1">
        {dashes.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            {row.map((w, j) => <span key={j} className={cx("h-[3px] transition-[width] duration-500", i === t % 16 && j === 1 ? "bg-lime" : "bg-steel/35")} style={{ width: `${w}%` }} />)}
          </div>
        ))}
      </div>
      <pre aria-hidden className="overflow-hidden border border-line bg-[#07070d] p-1.5 font-mono text-[8px] leading-[1.25] text-steel/45">{rows.join("\n")}</pre>
    </div>
  );
}

/* ── NULLIFIER REGISTRY: slots fill as withdrawals spend notes. */
function Nullifiers({ list }: { list: readonly string[] }) {
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 space-y-[5px] p-2.5">
        {Array.from({ length: 7 }, (_, i) => {
          const h = list[i];
          return (
            <li key={i} className={cx("flex h-7 items-center justify-between border px-2.5 font-mono text-[10px] transition-colors duration-500", h ? "border-line-strong bg-[#05050a]" : "border-line bg-black/60")}>
              <AnimatePresence mode="wait">
                {h && (
                  <motion.span key={h} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className={i === 0 ? "text-lime" : "text-muted"}>{h}</motion.span>
                )}
              </AnimatePresence>
              {h && <span className="text-[9px] uppercase text-lime">active</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-between border-t border-line px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        <span>Registry checks</span><span className="num text-fg/80">{list.length}</span>
      </div>
    </div>
  );
}

/* ── BATCH PROVER: nine constraint blocks fill with dots; the centre reports progress. */
function Prover({ t }: { t: number }) {
  const stages = ["witness", "constraints", "proving", "verifying", "accepted"];
  const phase = t % 10;
  const label = stages[Math.min(4, Math.floor(phase / 2))];
  return (
    <div className="grid h-full grid-cols-3 grid-rows-3 gap-[4px] p-2.5">
      {Array.from({ length: 9 }, (_, i) => {
        if (i === 4)
          return (
            <div key={i} className="grid place-items-center border border-line bg-black font-mono text-[10.5px] text-fg/85">
              <span className={label === "accepted" ? "text-lime" : ""}>{label}<span className="motion-safe:animate-blink">{label === "accepted" ? "" : ".."}</span></span>
            </div>
          );
        const done = (i + (i > 4 ? -1 : 0)) < phase;
        return (
          <div key={i} className={cx("border border-line bg-[radial-gradient(circle,currentColor_1px,transparent_1.3px)] bg-[length:6px_6px] transition-colors duration-500", done ? "text-lime/55" : "text-steel/25")} />
        );
      })}
    </div>
  );
}

/* ── VERIFIER: the chain side. ZKBLAST's own mark drawn as a dot matrix over binary rain. */
const MARK = (() => {
  // root node, stem, two branches, two leaves: 21x21 grid
  const g: number[][] = Array.from({ length: 21 }, () => Array.from<number>({ length: 21 }).fill(0));
  const disc = (cx: number, cy: number, r: number, v = 1) => { for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y][x] = v; };
  disc(10, 3, 2.4);
  for (let y = 5; y <= 9; y++) { g[y][10] = 1; g[y][9] = 1; }
  for (let k = 0; k <= 6; k++) { g[9 + k][10 - k] = 1; g[9 + k][9 - k] = 1; g[9 + k][10 + k] = 1; g[9 + k][11 + k] = 1; }
  disc(4, 16.5, 2.4);
  disc(16, 16.5, 2.8, 2);
  return g;
})();

function Verifier({ t, state, block }: { t: number; state: string; block: number }) {
  const rain = useMemo(() => {
    const r = seeded(4040 + t);
    return Array.from({ length: 34 }, () => Array.from({ length: 22 }, () => (r() < 0.55 ? (r() < 0.5 ? "0" : "1") : " ")).join(""));
  }, [t]);
  return (
    <div className="relative flex h-full flex-col">
      <pre aria-hidden className="absolute inset-0 overflow-hidden p-2 font-mono text-[9px] leading-[1.15] text-steel/[0.13]">{rain.join("\n")}</pre>
      <div className="relative grid flex-1 place-items-center py-6">
        <div aria-hidden className="grid grid-cols-[repeat(21,minmax(0,1fr))] gap-[2px]" style={{ width: "min(80%, 220px)" }}>
          {MARK.flat().map((v, i) => (
            <span key={i} className={cx("aspect-square rounded-[1px] transition-opacity duration-700", v === 2 ? "bg-lime" : v === 1 ? "bg-fg/80" : "bg-steel/[0.06]")}
              style={v === 1 ? { opacity: 0.45 + (((i * 13 + t) % 7) / 12) } : undefined} />
          ))}
        </div>
      </div>
      <dl className="relative space-y-1 border-t border-line bg-[#07070d]/90 px-3 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.08em]">
        <div className="flex justify-between"><dt className="text-faint">Verifier state</dt><dd className="text-lime normal-case">{state}</dd></div>
        <div className="flex justify-between"><dt className="text-faint">Proof pipeline</dt><dd className="text-fg/85">Monitoring</dd></div>
        <div className="flex justify-between"><dt className="text-faint">Block</dt><dd className="num text-fg/85">{block.toLocaleString("en-US")}</dd></div>
        <div className="flex justify-between"><dt className="text-faint">Root history</dt><dd className="text-fg/85">Tracked by indexer</dd></div>
      </dl>
    </div>
  );
}

export function TerminalOverview() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { margin: "0px 0px -10% 0px" });
  const t = useTick(inView);
  const { metrics, pools, swaps } = useProtocolData();
  const items = useMemo<Intent[]>(() => {
    const onchain = swaps.slice(0, 8).map((swap) => ({
      id: `${swap.transaction_hash}:${swap.log_index}`,
      lane: "public" as const,
      kind: "SWAP" as const,
      pair: "Onchain settlement",
      amount: `${swap.amount_in_raw} → ${swap.amount_out_raw}`,
      route: `block ${swap.block_number}`,
    }));
    const registered = pools.slice(0, 8).map((pool) => ({
      id: `pool:${pool.address}`,
      lane: "public" as const,
      kind: "ROUTE" as const,
      pair: `${pool.token0Symbol}/${pool.token1Symbol}`,
      amount: `${pool.model.toUpperCase()} route ${pool.status}`,
      route: `${pool.feeBps} bps`,
    }));
    return [...onchain, ...registered, ...pipelineBaseline].slice(0, 16);
  }, [pools, swaps]);
  const nulls = [...nullifierBaseline];
  const indexedBlock = Number(metrics?.indexedBlock ?? 0);
  const verifierRoot = metrics?.ready ? "Registry synchronized" : "Tracking chain state";

  return (
    <section ref={ref} aria-label="System overview" className="mx-auto max-w-[1392px] px-3 pt-24 sm:px-4 md:pt-32">
      <div className="px-1 sm:px-3">
        <Bay index="00" title="System overview" />
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_minmax(0,26rem)] md:items-end">
          <MaskHeading lines={["One pipeline.", "Every step on record."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
          <p className="font-mono text-[13px] leading-relaxed text-muted">
            Public intents are routed through the pools. Shielded intents become commitments, and withdrawals spend nullifiers behind a proof. This is the whole path, as it runs.
          </p>
        </div>
      </div>

      <div className="panel ticks mt-12 p-2 sm:p-3">
        <div className="mb-2 flex items-center justify-between px-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <span className="flex items-center gap-2"><span className="size-1.5 bg-lime motion-safe:animate-blink" aria-hidden />ZKBLAST / Pipeline terminal</span>
          <span className="flex items-center gap-1.5 text-lime"><span className="size-1.5 rounded-full bg-lime motion-safe:animate-pulse" aria-hidden />Live</span>
        </div>

        <div className="grid gap-3 lg:h-[760px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Column 1: intake */}
          <div className="grid min-h-0 gap-3 lg:grid-rows-[1fr_1.15fr]">
            <Panel title="Incoming_tx" className="h-56 lg:h-auto"><IncomingGrid t={t} /></Panel>
            <Panel title="Tx_queue" caption="Public + shielded intents" className="h-80 lg:h-auto"><Queue items={items} /></Panel>
          </div>

          {/* Column 2: public lane machinery */}
          <div className="grid min-h-0 gap-3 lg:grid-rows-[1fr_1fr]">
            <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <Panel title="Router" className="h-64 lg:h-auto"><Router items={items} /></Panel>
              <Panel title="Slippage guard" className="h-64 lg:h-auto"><Guard t={t} /></Panel>
            </div>
            <div className="hidden min-h-0 flex-col sm:flex">
              <Fins className="mb-2 hidden lg:block" />
              <Panel title="Executor" caption="Route / guard / settle" className="h-64 flex-1 lg:h-auto"><Executor t={t} /></Panel>
            </div>
          </div>

          {/* Column 3: shielded machinery */}
          <div className="grid min-h-0 gap-3 lg:grid-rows-[1fr_1.1fr]">
            <Panel title="Nullifier registry" className="h-80 lg:h-auto"><Nullifiers list={nulls} /></Panel>
            <Panel title="Batch prover" caption="Proof verification pipeline" className="h-72 lg:h-auto"><Prover t={t} /></Panel>
          </div>

          {/* Column 4: chain */}
          <Panel title="Robinhood Chain · verifier" caption="Chain verification state" className="h-[460px] lg:h-auto">
            <Verifier t={t} state={verifierRoot} block={indexedBlock} />
          </Panel>
        </div>
      </div>
      <div aria-hidden className="flex justify-between px-12 pt-1.5"><span className="barcode w-24" /><span className="barcode w-24" /><span className="barcode w-24" /></div>
    </section>
  );
}
