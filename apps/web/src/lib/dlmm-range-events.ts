export const dlmmRangeEvent = "zkblast:dlmm-range";

export type DlmmRangeDetail = Readonly<{
  pool: string;
  lower: number;
  upper: number;
  source: "chart" | "form";
}>;

export function publishDlmmRange(detail: DlmmRangeDetail) {
  window.dispatchEvent(new CustomEvent<DlmmRangeDetail>(dlmmRangeEvent, { detail }));
}

export function isDlmmRangeEvent(event: Event): event is CustomEvent<DlmmRangeDetail> {
  if (!(event instanceof CustomEvent)) return false;
  const detail = event.detail as Partial<DlmmRangeDetail> | undefined;
  return Boolean(
    detail &&
      typeof detail.pool === "string" &&
      Number.isInteger(detail.lower) &&
      Number.isInteger(detail.upper) &&
      (detail.source === "chart" || detail.source === "form"),
  );
}
