"use client";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useRef } from "react";
import { ButtonLink } from "@/components/ui/Button";

export function FinalCta() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const y = useTransform(scrollYProgress, [0, 1], [80, 0]);
  const glow = useTransform(scrollYProgress, [0.4, 1], [0, 1]);
  return (
    <section ref={ref} className="overflow-hidden px-4 pt-32 sm:px-6 md:pt-44">
      <motion.div style={{ y }} className="relative mx-auto max-w-[680px]">
        <div aria-hidden className="grip absolute -left-6 top-6 hidden h-20 sm:block" />
        <div aria-hidden className="grip absolute -right-6 bottom-10 hidden h-20 sm:block" />
        <div className="panel ticks p-2.5">
          <div className="panel-inset px-5 py-10 text-center sm:px-10">
            <h2 className="display text-[clamp(2rem,5vw,3.4rem)]">
              <span className="block text-fg/55">Provide.</span>
              <motion.span className="block text-lime" style={{ opacity: glow }}>Prove.</motion.span>
            </h2>
            <p className="mx-auto mt-6 max-w-md font-mono text-[13px] uppercase leading-relaxed tracking-[0.03em] text-muted">
              Start in the public pools. Move into the shielded vault whenever you need to, and watch every step of your proof run in your browser.
            </p>
          </div>
        </div>
        <div aria-hidden className="flex justify-center py-1.5"><span className="barcode w-20" /></div>
        <div className="panel ticks p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <ButtonLink href="/docs" size="lg" variant="secondary">Read the docs</ButtonLink>
            <ButtonLink href="/swap" size="lg">Launch app <ArrowRight className="size-4" aria-hidden /></ButtonLink>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
