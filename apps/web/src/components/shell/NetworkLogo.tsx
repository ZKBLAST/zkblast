import Image from "next/image";
import type { ChainFamily } from "@zkblast/config";
import { cx } from "@/lib/format";

const networkLogos: Record<ChainFamily, Readonly<{ src: string; alt: string }>> = {
  robinhood: {
    src: "/images/networks/robinhood.png",
    alt: "Robinhood Chain",
  },
  hyperevm: {
    src: "/images/networks/hyperliquid.png",
    alt: "Hyperliquid HyperEVM",
  },
};

export function NetworkLogo({
  family,
  className,
}: Readonly<{ family: ChainFamily; className?: string }>) {
  const logo = networkLogos[family];
  return (
    <span
      className={cx(
        "relative inline-flex size-7 shrink-0 overflow-hidden rounded-full border border-white/20 bg-white",
        className,
      )}
    >
      <Image
        src={logo.src}
        alt={logo.alt}
        fill
        sizes="32px"
        className="object-cover"
      />
    </span>
  );
}
