import { privacyBoundaries } from "@/data/shielded";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading, Reveal } from "@/components/ui/Reveal";
import { LaneBadge } from "@/components/ui/Badges";

const tone = (v: string) => (v.startsWith("Visible") ? "text-fg" : v.startsWith("Not") ? "text-faint" : "text-lime");

export function Disclosure() {
  return (
    <section className="mx-auto max-w-[1360px] px-4 pt-32 sm:px-6 md:pt-44">
      <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,28rem)] md:items-end">
        <Bay index="05" title="Disclosure" className="md:col-span-2" />
        <MaskHeading lines={["What stays", "public."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
        <Reveal>
          <p className="font-mono text-[13.5px] leading-relaxed text-muted">Privacy claims are only useful when they are exact. This is what each lane exposes today, including everything the shielded vault does not hide.</p>
        </Reveal>
      </div>
      <Reveal className="panel ticks mt-14 p-2">
        <ul className="panel-inset divide-y divide-line px-4 md:hidden">
          {privacyBoundaries.map((r) => (
            <li key={r.item} className="py-4">
              <p className="text-[15px] font-medium">{r.item}</p>
              <dl className="mt-2 grid grid-cols-2 gap-3 font-mono text-[12px]">
                <div><dt className="text-faint">Public AMM</dt><dd className={tone(r.publicAmm)}>{r.publicAmm}</dd></div>
                <div><dt className="text-faint">Shielded</dt><dd className={tone(r.shielded)}>{r.shielded}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
        <table className="panel-inset hidden w-full border-collapse text-left md:table">
          <caption className="sr-only">Information exposed by the public AMM and the shielded vault</caption>
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="w-[40%] py-4 pl-6 pr-4 font-mono text-[12px] font-normal uppercase tracking-wide text-faint">Information</th>
              <th scope="col" className="py-4 pr-4"><LaneBadge lane="public" /></th>
              <th scope="col" className="py-4"><LaneBadge lane="shielded" stage={false} /></th>
            </tr>
          </thead>
          <tbody>
            {privacyBoundaries.map((r) => (
              <tr key={r.item} className="group border-b border-line transition-colors hover:bg-surface">
                <th scope="row" className="py-4 pl-6 pr-4 font-mono text-[13px] font-normal uppercase tracking-[0.03em]">{r.item}</th>
                <td className={`py-4 pr-4 font-mono text-[13px] ${tone(r.publicAmm)}`}>{r.publicAmm}</td>
                <td className={`py-4 font-mono text-[13px] ${tone(r.shielded)}`}>{r.shielded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>
    </section>
  );
}
