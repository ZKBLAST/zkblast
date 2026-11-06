"use client";
import { formatUnits } from "viem";

export function TokenAmountField({
  label,
  symbol,
  decimals,
  value,
  balance,
  disabled,
  readOnly = false,
  onChange,
}: {
  label: string;
  symbol: string;
  decimals: number;
  value: string;
  balance?: bigint;
  disabled: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="mt-4 border border-line bg-bg/80 p-3">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{label}</span>
        <span>
          {balance === undefined
            ? "Balance unavailable"
            : `Balance ${formatUnits(balance, decimals)}`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          aria-label={`${label} ${symbol}`}
          className="w-full min-w-0 bg-transparent font-mono text-xl outline-none"
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value)}
        />
        <span className="shrink-0 border border-line px-2 py-1 font-mono text-xs">
          {symbol}
        </span>
      </div>
      {!readOnly && balance !== undefined && onChange && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={`${label} balance percentage`}>
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              disabled={disabled}
              className="cursor-pointer border border-line px-2 py-1 font-mono text-[9px] uppercase text-muted hover:text-lime disabled:opacity-40"
              onClick={() => onChange(formatUnits((balance * BigInt(percent)) / 100n, decimals))}
            >
              {percent === 100 ? "Max" : `${percent}%`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
