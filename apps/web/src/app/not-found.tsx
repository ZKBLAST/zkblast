import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[80dvh] max-w-[1360px] flex-col justify-center px-4 pt-[var(--header-h)] sm:px-6">
      <p className="num text-[13px] text-faint">404 · no leaf at this path</p>
      <h1 className="display mt-4 text-[clamp(3rem,10vw,4.4rem)]">Not in the tree.</h1>
      <p className="mt-5 max-w-md font-mono text-[13.5px] leading-relaxed text-muted">This page does not exist. The link may be old or mistyped.</p>
      <div className="mt-8 flex gap-3"><ButtonLink href="/">Go home</ButtonLink><ButtonLink href="/pools" variant="secondary">Browse pools</ButtonLink></div>
    </div>
  );
}
