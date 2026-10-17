import type { ReactNode } from "react";
import { MaskHeading } from "./Reveal";

export function PageHeader({ title, lead, aside, badges }: { title: string; lead?: string; aside?: ReactNode; badges?: ReactNode }) {
  return (
    <header className="mx-auto max-w-[1360px] px-4 pb-8 pt-[calc(var(--header-h)+2rem)] sm:px-6 md:pt-[calc(var(--header-h)+3rem)]">
      <div className="panel ticks p-2">
        <div className="panel-inset grid-field px-5 py-7 sm:px-8 sm:py-9">
          {badges && <div className="mb-5 flex flex-wrap gap-2">{badges}</div>}
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <MaskHeading as="h1" lines={[title]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
              {lead && <p className="mt-4 max-w-2xl font-mono text-[13.5px] leading-relaxed text-muted">{lead}</p>}
            </div>
            {aside}
          </div>
        </div>
      </div>
      <div aria-hidden className="flex justify-between px-10 pt-1.5"><span className="barcode w-20" /><span className="barcode w-20" /></div>
    </header>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="num mt-1.5 truncate text-[22px] font-normal text-fg sm:text-[26px]">{value}</dd>
      {sub && <dd className="mt-1">{sub}</dd>}
    </div>
  );
}
