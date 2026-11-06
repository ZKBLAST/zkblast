export const dlmmBinsTouchedEvent = "zkblast:dlmm-bins-touched";

export type DlmmBinsTouchedDetail = Readonly<{
  pool: string;
  lower: number;
  upper: number;
}>;

export function publishTouchedDlmmBins(detail: DlmmBinsTouchedDetail) {
  window.dispatchEvent(new CustomEvent<DlmmBinsTouchedDetail>(dlmmBinsTouchedEvent, { detail }));
}
