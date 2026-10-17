export function Sparkline({ data, width = 96, height = 28, up }: { data: number[]; width?: number; height?: number; up?: boolean }) {
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const d = data.map((v, i) => `${i ? "L" : "M"}${((i / (data.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join("");
  const rising = up ?? data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block">
      <path d={d} fill="none" stroke={rising ? "#3EE58E" : "#ff6b5e"} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
