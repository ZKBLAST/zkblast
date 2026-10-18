"use client";
import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { useProtocolData } from "@/lib/use-protocol-data";
import { cx } from "@/lib/format";

export function Ticker() {
  const [paused, setPaused] = useState(false);
  const { pools, loading } = useProtocolData();
  const row = (suffix: string) =>
    pools.map((pool) => (
      <li
        key={`${pool.address}${suffix}`}
        aria-hidden={suffix ? true : undefined}
        className="flex shrink-0 items-center gap-3 px-6 font-mono text-[13px]"
      >
        <span className="font-semibold text-fg">
          {pool.token0Symbol}/{pool.token1Symbol}
        </span>
        <span className="text-muted">{pool.model.toUpperCase()}</span>
        <span className="text-faint">{pool.feeBps} BPS</span>
        <span className="text-lime">{pool.status.toUpperCase()}</span>
        <span className="text-line-strong" aria-hidden>
          /
        </span>
      </li>
    ));
  return (
    <section
      aria-label="Indexed pools"
      className="group relative flex h-[50px] shrink-0 items-center border-y border-line bg-[#0a0a12]"
    >
      <div className="relative flex-1 overflow-hidden py-3.5 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
        {pools.length ? (
          <ul
            className={cx(
              "flex w-max animate-marquee group-hover:[animation-play-state:paused]",
              paused && "[animation-play-state:paused]",
            )}
          >
            {row("")}
            {row("-duplicate")}
          </ul>
        ) : (
          <p className="px-6 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
            {loading ? "Loading validated pools" : "No validated pools indexed"}
          </p>
        )}
      </div>
      <button
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? "Play pool ticker" : "Pause pool ticker"}
        className="grid h-12 w-12 shrink-0 cursor-pointer place-items-center border-l border-line text-muted hover:text-fg"
      >
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
      </button>
    </section>
  );
}
