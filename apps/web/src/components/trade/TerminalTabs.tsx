"use client";

import type { LucideIcon } from "lucide-react";
import { useRef } from "react";

export function TerminalTabs({
  prefix,
  label,
  items,
  value,
  disabled = false,
  onChange,
}: {
  prefix: string;
  label: string;
  items: readonly { value: string; label: string; icon?: LucideIcon }[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className="flex min-w-0 max-w-full overflow-x-auto overscroll-x-contain border-b border-line"
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          id={`${prefix}-tab-${item.value}`}
          aria-controls={`${prefix}-panel-${item.value}`}
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (
              disabled ||
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            )
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      items.length) %
                    items.length;
            const target = items[next];
            if (!target) return;
            onChange(target.value);
            const buttons =
              list.current?.querySelectorAll<HTMLButtonElement>("button");
            buttons?.[next]?.focus();
          }}
          className={`flex h-12 flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 border-b-2 px-3 font-mono text-xs disabled:cursor-wait ${value === item.value ? "border-lime bg-lime/15 font-bold text-lime shadow-[inset_0_-2px_0_var(--color-lime)]" : "border-transparent text-muted hover:bg-raised hover:text-fg"}`}
        >
          {item.icon && <item.icon className="size-3.5" aria-hidden />}
          {item.label}
        </button>
      ))}
    </div>
  );
}
