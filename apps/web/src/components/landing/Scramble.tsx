"use client";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const GLYPHS = "0123456789ABCDEF";

// Resolves hex noise into the word, left to right: a hash becoming readable.
export function Scramble({ text, delay = 0, speed = 38, className }: { text: string; delay?: number; speed?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [out, setOut] = useState(text);

  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    let id: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      id = setInterval(() => {
        frame++;
        const resolved = Math.floor(frame / 2.4);
        setOut(
          text.split("").map((c, i) => (c === " " || c === "." ? c : i < resolved ? c : GLYPHS[(Math.random() * 16) | 0])).join(""),
        );
        if (resolved >= text.length) clearInterval(id);
      }, speed);
    }, delay);
    return () => { clearTimeout(start); clearInterval(id); };
  }, [text, delay, speed, reduce]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{out}</span>
    </span>
  );
}
