"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/format";
import { easeOut } from "@/lib/motion";

type Props = { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string; dismissible?: boolean };

export function Modal({ open, onClose, title, children, width = "max-w-md", dismissible = true }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
      first?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose();
      if (e.key !== "Tab" || !panel.current) return;
      const els = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")];
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-2 sm:items-center sm:p-6" style={{ overscrollBehavior: "contain" }}>
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
            onClick={dismissible ? onClose : undefined}
          />
          <motion.div
            ref={panel}
            role="dialog" aria-modal="true" aria-label={title}
            className={cx("panel ticks relative w-full", width)}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: easeOut } }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99, transition: { duration: 0.16 } }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="wide text-[13.5px]">{title}</h2>
              {dismissible && (
                <button onClick={onClose} aria-label="Close" className="-mr-2 grid size-10 place-items-center rounded-sm text-muted transition-colors hover:bg-raised hover:text-fg cursor-pointer">
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="max-h-[78dvh] overflow-y-auto px-5 py-5" data-lenis-prevent>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
