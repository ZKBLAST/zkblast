"use client";

import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon: LucideIcon }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative shrink-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
        if (!open || !menu.current?.contains(event.target as Node)) return;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const buttons = [
          ...menu.current.querySelectorAll<HTMLButtonElement>(
            '[role="menuitemradio"]',
          ),
        ];
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`${label}: ${selected?.label ?? value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`flex h-9 min-w-32 cursor-pointer items-center gap-2 border bg-raised px-3 font-mono text-xs text-fg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${open ? "border-lime" : "border-line hover:border-line-strong"}`}
      >
        {selected && (
          <selected.icon className="size-4 text-muted" aria-hidden />
        )}
        <span className="flex-1 text-left">{selected?.label ?? value}</span>
        <ChevronDown
          className={`size-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-40 mt-1 min-w-44 border border-line-strong bg-bg p-1 shadow-[0_12px_28px_#0009]"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={-1}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                trigger.current?.focus();
              }}
              className={`flex min-h-10 w-full cursor-pointer items-center gap-3 px-3 text-left font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-lime ${option.value === value ? "bg-lime/15 text-lime" : "text-muted hover:bg-raised hover:text-fg focus-visible:bg-raised"}`}
            >
              <option.icon className="size-4" aria-hidden />
              <span className="flex-1">{option.label}</span>
              {option.value === value && (
                <Check className="size-3.5" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
