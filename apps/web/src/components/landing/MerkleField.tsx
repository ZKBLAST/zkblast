"use client";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

const DEPTH = 4;
const LEAVES = 1 << DEPTH;
const W = 1000;
const H = 600;

type Node = { level: number; index: number; x: number; y: number };

function layout(): Node[] {
  const out: Node[] = [];
  for (let level = 0; level <= DEPTH; level++) {
    const count = 1 << level;
    for (let i = 0; i < count; i++) {
      out.push({ level, index: i, x: ((i + 0.5) / count) * W, y: 60 + (level / DEPTH) * (H - 140) });
    }
  }
  return out;
}

const hexOf = (n: number) => {
  let h = (n * 2654435761) >>> 0;
  let s = "";
  for (let i = 0; i < 8; i++) { h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; s += (h & 0xff).toString(16).padStart(2, "0"); }
  return "0x" + s.slice(0, 4) + "…" + s.slice(-4);
};

// Path from leaf to root as node keys.
const pathOf = (leaf: number) => {
  const keys: string[] = [];
  let i = leaf;
  for (let level = DEPTH; level >= 0; level--) { keys.push(`${level}-${i}`); i = i >> 1; }
  return keys;
};

export function MerkleField({ scrollProgress, onInsert }: { scrollProgress: MotionValue<number>; onInsert?: (leaf: number, root: string) => void }) {
  const reduce = useReducedMotion();
  const nodes = useMemo(layout, []);
  const byKey = useMemo(() => new Map(nodes.map((n) => [`${n.level}-${n.index}`, n])), [nodes]);
  const [filled, setFilled] = useState(9);
  const [active, setActive] = useState<number | null>(null);
  const [tick, setTick] = useState(1283);
  const ref = useRef<HTMLDivElement>(null);

  // Pointer tilt: the tree is a physical object you can lean.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rx = useSpring(useTransform(py, [-1, 1], [7, -7]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(px, [-1, 1], [-9, 9]), { stiffness: 120, damping: 18 });
  const y = useTransform(scrollProgress, [0, 1], [0, 140]);
  const scale = useTransform(scrollProgress, [0, 1], [1, 0.9]);
  const opacity = useTransform(scrollProgress, [0, 0.85], [1, 0.15]);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setFilled((f) => {
        const next = f >= LEAVES ? 1 : f + 1;
        const leaf = next - 1;
        setActive(leaf);
        setTick((t) => {
          onInsert?.(t + 1, hexOf(t + 1));
          return t + 1;
        });
        return next;
      });
    }, 1700);
    return () => clearInterval(id);
  }, [reduce, onInsert]);

  useEffect(() => {
    if (reduce) return;
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      px.set(((e.clientX - r.left) / r.width) * 2 - 1);
      py.set(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const reset = () => { px.set(0); py.set(0); };
    window.addEventListener("pointermove", onMove);
    document.addEventListener("pointerleave", reset);
    return () => { window.removeEventListener("pointermove", onMove); document.removeEventListener("pointerleave", reset); };
  }, [px, py, reduce]);

  const lit = new Set(active !== null ? pathOf(active) : []);
  const edges = nodes.filter((n) => n.level > 0).map((n) => ({ child: n, parent: byKey.get(`${n.level - 1}-${n.index >> 1}`)! }));

  return (
    <div ref={ref} className="absolute inset-0" style={{ perspective: 1400 }} aria-hidden>
      <motion.div className="absolute inset-0" style={{ rotateX: rx, rotateY: ry, y, scale, opacity, transformStyle: "preserve-3d" }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          {edges.map(({ child, parent }) => {
            const on = lit.has(`${child.level}-${child.index}`);
            return (
              <g key={`${child.level}-${child.index}`}>
                <path d={`M${parent.x},${parent.y} C${parent.x},${(parent.y + child.y) / 2} ${child.x},${(parent.y + child.y) / 2} ${child.x},${child.y}`} fill="none" stroke="#2e3047" strokeWidth={1} />
                {on && (
                  <motion.path
                    key={`lit-${tick}`}
                    d={`M${child.x},${child.y} C${child.x},${(parent.y + child.y) / 2} ${parent.x},${(parent.y + child.y) / 2} ${parent.x},${parent.y}`}
                    fill="none" stroke="#dfe3ee" strokeWidth={1.6}
                    initial={{ pathLength: 0, opacity: 1 }}
                    animate={{ pathLength: 1, opacity: [1, 1, 0.35] }}
                    transition={{ duration: 0.5, delay: (DEPTH - child.level) * 0.16, ease: "easeOut", opacity: { duration: 1.6, delay: (DEPTH - child.level) * 0.16 } }}
                  />
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const key = `${n.level}-${n.index}`;
            const isLeaf = n.level === DEPTH;
            const isFilled = isLeaf ? n.index < filled : true;
            const on = lit.has(key);
            const r = n.level === 0 ? 11 : isLeaf ? 7 : 5;
            return (
              <g key={key}>
                {on && (
                  <motion.circle key={`pulse-${tick}`} cx={n.x} cy={n.y} r={r} fill="none" stroke="#dfe3ee" strokeWidth={1}
                    initial={{ scale: 1, opacity: 0.9 }} animate={{ scale: 3.2, opacity: 0 }}
                    transition={{ duration: 1.1, delay: (DEPTH - n.level) * 0.16, ease: "easeOut" }}
                    style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  />
                )}
                <circle cx={n.x} cy={n.y} r={r}
                  fill={on ? "#dfe3ee" : isLeaf ? (isFilled ? "#e9ebf5" : "#06060c") : "#13131f"}
                  stroke={isLeaf && !isFilled ? "#2e3047" : on ? "#dfe3ee" : "#747a96"} strokeWidth={1}
                  style={{ transition: "fill 300ms ease-out, stroke 300ms ease-out" }}
                />
              </g>
            );
          })}
          <text x={W / 2} y={30} textAnchor="middle" className="fill-[#a3a8c0] font-mono" fontSize={13}>root {hexOf(tick)}</text>
          {nodes.filter((n) => n.level === DEPTH).map((n) => (
            <text key={`t${n.index}`} x={n.x} y={n.y + 26} textAnchor="middle" className="font-mono" fontSize={10} fill={n.index < filled ? "#747a96" : "#2e3047"}>
              {String(n.index).padStart(2, "0")}
            </text>
          ))}
        </svg>
      </motion.div>
    </div>
  );
}
