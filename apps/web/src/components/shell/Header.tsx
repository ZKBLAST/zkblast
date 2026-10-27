"use client";
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
} from "motion/react";
import { ChevronDown, LogOut, Menu, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx, shortHex } from "@/lib/format";
import { nav } from "@/lib/nav";
import { XIcon } from "@/components/ui/Icons";
import { useApp } from "./AppProvider";
import { Logo } from "./Logo";

export function Header() {
  const path = usePathname();
  const { address, config, connect, disconnect, injectedAddress } = useApp();
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [acct, setAcct] = useState(false);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setScrolled(y > 8);
    setHidden(y > 240 && y > prev && !menu);
  });

  useEffect(() => {
    setMenu(false);
    setAcct(false);
  }, [path]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[200] focus:rounded-sm focus:bg-lime focus:px-3 focus:py-2 focus:text-lime-ink"
      >
        Skip to content
      </a>
      <motion.header
        animate={{ y: hidden && path !== "/trade" ? "-100%" : "0%" }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={cx(
          "fixed inset-x-0 top-0 z-50 h-[var(--header-h)] border-b transition-colors duration-200",
          scrolled
            ? "border-line bg-[#0b0b14]/85 backdrop-blur-md"
            : "border-line bg-[#0b0b14]/60",
        )}
      >
        <div className="mx-auto flex h-full max-w-[1392px] items-stretch border-x border-line">
          <Link
            href="/"
            aria-label="ZKBLAST home"
            className="flex items-center border-r border-line px-4 sm:px-6 lg:w-[220px]"
          >
            <Logo compact />
          </Link>

          <nav
            aria-label="Primary"
            className="hidden flex-1 justify-center lg:flex"
          >
            <ul className="flex items-stretch">
              {nav.map((n) => {
                const on = path === n.href || path.startsWith(n.href + "/");
                return (
                  <li
                    key={n.href}
                    className="flex border-r border-line first:border-l"
                  >
                    <Link
                      href={n.href}
                      aria-current={on ? "page" : undefined}
                      className={cx(
                        "relative flex items-center px-5 font-mono text-[12.5px] uppercase tracking-[0.06em] transition-colors duration-150 xl:px-7",
                        on
                          ? "text-fg"
                          : "text-muted hover:bg-white/[0.02] hover:text-fg",
                      )}
                    >
                      {n.label}
                      {on && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-x-0 bottom-0 h-px bg-lime shadow-[0_0_12px_rgba(223,227,238,0.8)]"
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 36,
                          }}
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-1 border-l border-line px-2 sm:gap-2 sm:px-4 lg:ml-0">
            <span
              className="hidden h-9 items-center gap-2 border border-line px-2.5 font-mono text-[11px] uppercase tracking-wide text-muted xl:inline-flex"
              title="Network status"
            >
              <span
                className="size-1.5 rounded-full bg-lime shadow-[0_0_8px_rgba(223,227,238,0.8)]"
                aria-hidden
              />
              {config?.chainName ?? "API sync"}
            </span>

            <a
              href="https://x.com/zkblast20"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ZKBLAST on X (Twitter)"
              title="Follow @zkblast20 on X"
              className="inline-flex size-10 items-center justify-center border border-line text-muted transition-colors hover:border-lime/60 hover:text-fg hover:bg-white/[0.02]"
            >
              <XIcon className="size-4" />
            </a>

            {address ? (
              <div className="relative">
                <button
                  onClick={() => setAcct((v) => !v)}
                  aria-expanded={acct}
                  className="inline-flex h-10 items-center gap-2 border border-line-strong bg-raised px-3 font-mono text-[12.5px] transition-colors hover:border-steel/40 cursor-pointer"
                >
                  <span className="size-1.5 bg-lime" aria-hidden />
                  {shortHex(address)}
                  <ChevronDown
                    className={cx(
                      "size-3.5 text-muted transition-transform duration-200",
                      acct && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                <AnimatePresence>
                  {acct && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{
                        opacity: 0,
                        y: -4,
                        transition: { duration: 0.12 },
                      }}
                      className="panel ticks absolute right-0 top-12 w-60 p-1.5"
                    >
                      <p className="px-3 pb-2 pt-2 font-mono text-[11px] text-faint break-all">
                        {address}
                      </p>
                      <Link
                        href="/trade?panel=positions"
                        onClick={() => setAcct(false)}
                        className="flex h-10 items-center px-3 font-mono text-[12px] uppercase tracking-wide text-muted hover:bg-raised hover:text-fg"
                      >
                        My positions
                      </Link>
                      <Link href="/trade?panel=history" onClick={() => setAcct(false)}
                        className="flex h-10 items-center px-3 font-mono text-[12px] uppercase tracking-wide text-muted hover:bg-raised hover:text-fg">
                        Account and history
                      </Link>
                      <Link
                        href="/trade?mode=shielded"
                        onClick={() => setAcct(false)}
                        className="flex h-10 items-center px-3 font-mono text-[12px] uppercase tracking-wide text-muted hover:bg-raised hover:text-fg"
                      >
                        My notes
                      </Link>
                      <button
                        onClick={() => {
                          void disconnect();
                          setAcct(false);
                        }}
                        className="flex h-10 w-full items-center gap-2 px-3 font-mono text-[12px] uppercase tracking-wide text-danger hover:bg-raised cursor-pointer"
                      >
                        <LogOut className="size-4" aria-hidden /> Disconnect
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                onClick={connect}
                title={
                  injectedAddress
                    ? "Wallet connected — sign in to create a ZKBLAST session"
                    : "Connect wallet"
                }
                className="inline-flex h-10 items-center gap-2 border border-line-strong bg-[linear-gradient(180deg,#1a1b2a,#11111c)] px-4 font-mono text-[12.5px] uppercase tracking-[0.06em] text-fg shadow-[inset_0_1px_0_rgba(174,188,229,0.08)] transition-colors hover:border-lime/60 hover:text-lime cursor-pointer"
              >
                <Wallet className="size-4" aria-hidden />{" "}
                {injectedAddress ? shortHex(injectedAddress) : "Connect"}
              </button>
            )}

            <button
              onClick={() => setMenu((v) => !v)}
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              className="grid size-10 place-items-center border border-line text-fg lg:hidden cursor-pointer"
            >
              {menu ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {menu && (
          <motion.div
            className="fixed inset-x-0 bottom-0 top-[var(--header-h)] z-40 bg-bg lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            <nav aria-label="Mobile" className="px-4 pt-6">
              <motion.ul
                initial="h"
                animate="s"
                variants={{
                  h: {},
                  s: { transition: { staggerChildren: 0.04 } },
                }}
              >
                {nav.map((n) => (
                  <motion.li
                    key={n.href}
                    variants={{
                      h: { opacity: 0, x: -16 },
                      s: { opacity: 1, x: 0 },
                    }}
                    className="border-b border-line"
                  >
                    <Link
                      href={n.href}
                      className={cx(
                        "flex h-16 items-center justify-between font-mono text-[20px] uppercase tracking-[0.04em]",
                        path.startsWith(n.href) ? "text-lime" : "text-fg",
                      )}
                    >
                      {n.label}
                    </Link>
                  </motion.li>
                ))}
                <motion.li
                  variants={{
                    h: { opacity: 0, x: -16 },
                    s: { opacity: 1, x: 0 },
                  }}
                  className="border-b border-line"
                >
                  <a
                    href="https://x.com/zkblast20"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-16 items-center justify-between font-mono text-[20px] uppercase tracking-[0.04em] text-fg hover:text-lime"
                  >
                    <span>Follow on X</span>
                    <XIcon className="size-5" />
                  </a>
                </motion.li>
              </motion.ul>
              <p className="mt-6 font-mono text-xs uppercase tracking-wide text-faint">
                {config
                  ? `${config.chainName} · Chain ${config.chainId}`
                  : "Synchronizing network configuration"}
              </p>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
