"use client";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { easeOut } from "@/lib/motion";

export function Reveal({ children, delay = 0, y = 28, className, as = "div" }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: "div" | "li" | "section" }) {
  const reduce = useReducedMotion();
  const M = motion[as];
  return (
    <M
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: 0.8, delay, ease: easeOut }}
    >
      {children}
    </M>
  );
}

// Heading whose lines rise out of a mask as they enter. The parent observes the
// viewport because the clipped lines themselves never intersect. Later lines sit a tone down.
export function MaskHeading({ lines, className, as = "h2", twoTone = true }: { lines: string[]; className?: string; as?: "h1" | "h2" | "h3"; twoTone?: boolean }) {
  const reduce = useReducedMotion();
  const M = motion[as];
  return (
    <M className={className} initial={reduce ? false : "hidden"} whileInView="show" viewport={{ once: true, margin: "-8% 0px" }} variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}>
      {lines.map((l, i) => (
        <span key={i} className="block overflow-hidden pb-[0.06em]">
          <motion.span className={twoTone && i > 0 ? "block text-fg/45" : "block"} variants={{ hidden: { y: "110%" }, show: { y: 0, transition: { duration: 0.9, ease: easeOut } } }}>
            {l}
          </motion.span>
        </span>
      ))}
    </M>
  );
}
