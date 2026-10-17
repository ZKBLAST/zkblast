// Mark: a root node splitting into two leaves, one lit. The protocol's two lanes, one shielded.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
        <rect x="0.5" y="0.5" width="27" height="27" rx="1" fill="none" stroke="currentColor" strokeOpacity="0.25" />
        <path d="M14 7v5M14 12l-6 6M14 12l6 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <circle cx="14" cy="7" r="2.2" fill="currentColor" />
        <circle cx="8" cy="19.5" r="2.2" fill="currentColor" />
        <circle cx="20" cy="19.5" r="2.6" fill="#dfe3ee" />
      </svg>
      <span className="font-mono text-[15px] font-medium tracking-[0.08em]">ZKBLAST</span>
    </span>
  );
}
