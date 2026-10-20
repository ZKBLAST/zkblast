"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AssetLogo } from "@/components/markets/AssetLogo";
import { Skeleton } from "@/components/ui/Skeleton";
import type { PoolTokenOption } from "@/lib/pool-creation-tokens";

export function PoolTokenSelect({
  label,
  value,
  exclude,
  options,
  loading,
  error,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  exclude: string;
  options: readonly PoolTokenOption[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onChange: (address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const selected = options.find((item) => item.address === value.toLowerCase());
  const initialLoading = loading && options.length === 0;
  const matches = options.filter((item) =>
    `${item.symbol} ${item.name} ${item.address ?? ""}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
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
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span id={`${id}-label`} className="text-sm">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-busy={initialLoading}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        className="mt-2 flex min-h-12 w-full items-center gap-3 border border-line bg-bg px-3 py-2 text-left disabled:opacity-50"
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        {initialLoading ? (
          <TokenLoading />
        ) : (
          selected && (
            <AssetLogo url={logoFor(selected)} label={selected.symbol} />
          )
        )}
        <span
          id={`${id}-value`}
          className={initialLoading ? "sr-only" : "min-w-0 flex-1 text-sm"}
        >
          {initialLoading
            ? "Loading tokens"
            : (selected?.symbol ?? "Select a token")}
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </button>
      {selected?.address && (
        <p className="mt-1 break-all font-mono text-[10px] text-faint">
          {selected.address}
        </p>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 border border-line bg-bg p-2 shadow-xl">
          <label className="flex items-center gap-2 border border-line px-2 transition-colors focus-within:border-line-strong focus-within:bg-raised">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              ref={search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={`Search ${label}`}
              placeholder="Search name, symbol or address"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none focus:outline-none focus-visible:outline-none focus:ring-0"
            />
          </label>
          {error && (
            <p role="status" className="px-2 py-2 text-xs text-warn">
              Some token sources could not be loaded. Available entries are
              shown.
            </p>
          )}
          <ul
            id={`${id}-list`}
            aria-label={`${label} options`}
            aria-busy={initialLoading}
            className="mt-2 max-h-72 overflow-y-auto overscroll-contain"
            data-lenis-prevent
          >
            {initialLoading &&
              Array.from({ length: 4 }, (_, index) => (
                <li key={index} className="px-2 py-3">
                  <TokenLoading />
                </li>
              ))}
            {!initialLoading && !matches.length && (
              <li className="p-3 text-xs text-muted">
                No matching tokens on this network.
              </li>
            )}
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={
                    !item.address || item.address === exclude.toLowerCase()
                  }
                  aria-pressed={
                    item.address !== null &&
                    item.address === value.toLowerCase()
                  }
                  className="flex w-full items-start gap-2 px-2 py-3 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    if (!item.address) return;
                    onChange(item.address);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <AssetLogo url={logoFor(item)} label={item.symbol} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {item.symbol}{" "}
                      <span className="text-xs text-muted">{item.name}</span>
                    </span>
                    <span className="mt-1 block break-all font-mono text-[10px] text-faint">
                      {item.address ?? "No token contract on this network"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TokenLoading() {
  return (
    <span className="flex min-h-9 flex-1 items-center gap-3" aria-hidden="true">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <span className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-2 w-3/5 max-w-40" />
      </span>
    </span>
  );
}

function logoFor(token: PoolTokenOption) {
  return ["USDG", "WETH", "ETH"].includes(token.symbol.toUpperCase())
    ? `/asset-logo/${token.symbol.toUpperCase()}`
    : token.logoUrl;
}
