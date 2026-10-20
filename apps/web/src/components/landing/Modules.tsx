import { modules } from "@/data/protocol";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading, Reveal } from "@/components/ui/Reveal";

export function Modules() {
  return (
    <section className="mx-auto max-w-[1360px] px-4 pt-32 sm:px-6 md:pt-44">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Bay index="07" title="Contracts" className="mb-6" />
          <MaskHeading lines={["The contracts."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
          <Reveal>
            <p className="mt-6 font-mono text-[13.5px] leading-relaxed text-muted">Small, composable contracts, each with one job. Custody stays non-upgradeable where possible, and every proof is checked onchain against a registered verification key.</p>
          </Reveal>
        </div>
        <ul className="panel ticks px-2 py-2">
          {modules.map((m, i) => (
            <Reveal as="li" key={m.name} delay={i * 0.04} y={16} className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-line px-3 py-5 transition-colors last:border-0 hover:bg-white/[0.02] xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:px-5">
              <span className="break-words font-mono text-[14px] font-semibold text-fg transition-colors group-hover:text-lime [overflow-wrap:anywhere]">{m.name}.sol</span>
              <span className="col-span-2 row-start-2 font-mono text-[13px] text-muted xl:col-span-1 xl:row-start-auto">{m.role}</span>
              <span className="col-start-2 row-start-1 justify-self-end font-mono text-[12px] text-faint xl:col-start-auto xl:row-start-auto">{m.layer}</span>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
