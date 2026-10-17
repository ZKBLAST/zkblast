"use client";
import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { pools } from "@/data/pools";
import { tokenBySymbol } from "@/data/tokens";
import { fmtPrice, fmtUsdCompact, cx } from "@/lib/format";

export function Ticker() {
  const [paused, setPaused] = useState(false);
  const row = (sfx: string) => pools.map((p) => {
    const ch = tokenBySymbol(p.base).change24h;
    return (
      <li key={p.id + sfx} aria-hidden={sfx ? true : undefined} className="flex shrink-0 items-center gap-3 px-6 font-mono text-[13px]">
        <span className="font-semibold text-fg">{p.base}/{p.quote}</span>
        <span className="text-muted">{fmtPrice(p.price)}</span>
        <span className={ch >= 0 ? "text-up" : "text-danger"}>{ch >= 0 ? "+" : ""}{ch.toFixed(2)}%</span>
        <span className="text-faint">vol {fmtUsdCompact(p.volume24hUsd)}</span>
        <span className="text-line-strong" aria-hidden>/</span>
      </li>
    );
  });
  return (
    <section aria-label="Pool prices" className="group relative flex h-[50px] shrink-0 items-center border-y border-line bg-[#0a0a12]">
      <div className="relative flex-1 overflow-hidden py-3.5 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
        <ul className={cx("flex w-max animate-marquee group-hover:[animation-play-state:paused]", paused && "[animation-play-state:paused]")}>
          {row("")}
          {row("-dup")}
        </ul>
      </div>
      <button onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play price ticker" : "Pause price ticker"} className="grid h-12 w-12 shrink-0 place-items-center border-l border-line text-muted hover:text-fg cursor-pointer">
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </button>
    </section>
  );
}
