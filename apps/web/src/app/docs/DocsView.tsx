"use client";
import { motion } from "motion/react";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { LaneBadge } from "@/components/ui/Badges";
import { ContractDirectory } from "@/components/docs/ContractDirectory";
import { useApp } from "@/components/shell/AppProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { docs } from "@/data/docs";
import { cx } from "@/lib/format";
import { ShieldedRiskNotice } from "@/components/shielded/ShieldedRiskNotice";

const all = docs.flatMap((g) => g.sections);

export function DocsView() {
  const { config } = useApp();
  const [active, setActive] = useState(all[0].id);

  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const vis = es
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    all.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <>
      <PageHeader
        title="Docs"
        lead="How the public pools and the shielded vault work, what each one reveals, and what is not built yet."
        badges={
          <>
            <LaneBadge lane="public" />
            <LaneBadge
              lane="shielded"
              stage={config?.environment === "testnet"}
            />
          </>
        }
      />
      <div className="mx-auto max-w-[1360px] px-4 sm:px-6">
        <ShieldedRiskNotice config={config} />
      </div>
      <div className="mx-auto grid max-w-[1360px] gap-10 px-4 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav
          aria-label="Documentation"
          className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:self-start"
        >
          {docs.map((g) => (
            <div key={g.group} className="mb-6">
              <p className="font-mono text-[12px] uppercase tracking-wide text-faint">
                {g.group}
              </p>
              <ul className="mt-2 border-l border-line">
                {g.sections.map((s) => (
                  <li key={s.id} className="relative">
                    {active === s.id && (
                      <motion.span
                        layoutId="doc-active"
                        className="absolute -left-px inset-y-1 w-[2px] bg-lime"
                      />
                    )}
                    <a
                      href={`#${s.id}`}
                      aria-current={active === s.id ? "true" : undefined}
                      className={cx(
                        "block py-1.5 pl-4 text-[15px] transition-colors",
                        active === s.id
                          ? "text-fg"
                          : "text-muted hover:text-fg",
                      )}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <article className="min-w-0 max-w-[70ch]">
          {docs.map((g) => (
            <div key={g.group}>
              {g.sections.map((s) => (
                <section
                  key={s.id}
                  id={s.id}
                  className="scroll-mt-[calc(var(--header-h)+2rem)] border-b border-line pb-12 pt-2 [&:not(:first-child)]:pt-12"
                >
                  <h2 className="display text-[clamp(1.8rem,3.4vw,2.6rem)]">
                    {s.title}
                  </h2>
                  <div className="mt-5 space-y-4 text-[16px] leading-relaxed text-muted">
                    {s.body.map((b, i) =>
                      typeof b === "string" ? (
                        <p key={i}>{b}</p>
                      ) : "list" in b ? (
                        <ul
                          key={i}
                          className="space-y-2 pl-5 [list-style:square] marker:text-lime"
                        >
                          {b.list.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      ) : "code" in b ? (
                        <pre
                          key={i}
                          className="overflow-x-auto panel p-4 font-mono text-[14px] text-fg"
                        >
                          <code>{b.code}</code>
                        </pre>
                      ) : (
                        <p
                          key={i}
                          className="flex gap-3 rounded-md border border-warn/40 bg-warn/[0.05] p-4 text-[15px] text-fg"
                        >
                          <Info
                            className="mt-0.5 size-4 shrink-0 text-warn"
                            aria-hidden
                          />
                          {b.note}
                        </p>
                      ),
                    )}
                  </div>
                  {s.id === "deployments" ? <ContractDirectory /> : null}
                </section>
              ))}
            </div>
          ))}
          <section className="pt-12">
            <h2 className="display text-[clamp(1.8rem,3.4vw,2.6rem)]">
              Architecture
            </h2>
            <pre className="mt-5 overflow-x-auto panel p-5 font-mono text-[13px] leading-relaxed text-muted">{`Web app
 ├─ Public pools · DLMM · DAMM · Swap ──► Public AMM router ──► AMM contracts
 ├─ Shielded vault · notes · proof status
 │    └─ Client-side prover ── proof + public inputs ──► Vault / Verifier
 └─ Read API / indexer ──► pool state, events, Merkle roots (never note secrets)

Robinhood Chain
 ├─ AMM contracts
 ├─ ZKBlastVault
 ├─ CommitmentTree + NullifierRegistry
 ├─ VerifierRegistry + ZKVerifierAdapter
 └─ ShieldedLPManager (later)`}</pre>
          </section>
        </article>
      </div>
    </>
  );
}
