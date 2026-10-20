import { cx } from "@/lib/format";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("content-shimmer block rounded-sm", className)}
    />
  );
}
