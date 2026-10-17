"use client";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { roadmap } from "@/data/protocol";
import { Bay } from "@/components/ui/Frame";
import { MaskHeading } from "@/components/ui/Reveal";

export function Roadmap() {
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const reduce = useReducedMotion();
  const [dist, setDist] = useState(0);
  const [pin, setPin] = useState(false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0.05, 0.95], [0, -dist]);

  useEffect(() => {
    const measure = () => {
      const wide = window.innerWidth >= 900 && !reduce;
      setPin(wide);
      if (track.current) setDist(Math.max(0, track.current.scrollWidth - window.innerWidth + 48));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [reduce]);

  return (
    <section ref={ref} className="relative mt-32 md:mt-44" style={{ height: pin ? `calc(100dvh + ${dist}px)` : "auto" }} aria-label="Roadmap">
      <div className={pin ? "sticky top-0 flex h-[100dvh] flex-col justify-center overflow-hidden" : ""}>
        <div className="mx-auto w-full max-w-[1360px] px-4 sm:px-6">
          <Bay index="06" title="Roadmap" className="mb-6" />
          <MaskHeading lines={["Shipped in order.", "Built to last."]} className="display text-[clamp(2.2rem,4.6vw,3.6rem)]" />
        </div>
        <motion.ol ref={track} style={pin ? { x } : undefined} className={pin ? "mt-14 flex w-max gap-4 pl-[max(1.5rem,calc((100vw-1360px)/2+1.5rem))] pr-6" : "mx-auto mt-10 grid max-w-[1360px] gap-4 px-4 sm:px-6"}>
          {roadmap.map((r, i) => (
            <li key={r.phase} className="flex w-full flex-col panel ticks p-6 md:w-[380px] md:p-8">
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em]">
                <span className="text-faint">{r.phase}</span>
                <span className={r.status === "Live" ? "text-lime" : r.status === "Rolling out" ? "text-steel" : "text-muted"}>{r.status}</span>
              </div>
              <h3 className="wide mt-10 text-[17px]">{r.title}</h3>
              <ul className="panel-inset mt-6 space-y-2 px-4 py-4 font-mono text-[12.5px] uppercase tracking-[0.03em] text-muted">
                {r.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <div className="mt-auto pt-8">
                <div className="h-1 rounded-full bg-line">
                  <div className="h-1 rounded-full bg-lime" style={{ width: i === 0 ? "62%" : "0%" }} />
                </div>
              </div>
            </li>
          ))}
        </motion.ol>
      </div>
    </section>
  );
}
