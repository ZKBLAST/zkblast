import Image from "next/image";

export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-xs border border-line-strong bg-black">
        <Image
          src="/zk/logo.png"
          alt="ZKBLAST logo"
          width={28}
          height={28}
          className="size-full object-contain"
          priority
        />
      </span>
      <span className={`${compact ? "hidden min-[380px]:inline" : ""} font-mono text-[15px] font-medium tracking-[0.08em]`}>ZKBLAST</span>
    </span>
  );
}

