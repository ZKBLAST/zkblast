"use client";
import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function SmoothScroll() {
  const lenis = useRef<Lenis | null>(null);
  const path = usePathname();

  useEffect(() => {
    if (path === "/trade") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const l = new Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true });
    lenis.current = l;
    let raf = 0;
    const loop = (t: number) => { l.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); l.destroy(); lenis.current = null; };
  }, [path]);

  useEffect(() => {
    lenis.current?.scrollTo(0, { immediate: true });
  }, [path]);

  return null;
}
