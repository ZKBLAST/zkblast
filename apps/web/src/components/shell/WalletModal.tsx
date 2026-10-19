"use client";

import { Loader2, Puzzle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useApp } from "./AppProvider";

export function WalletModal({
  open,
  onClose,
}: Readonly<{ open: boolean; onClose: () => void }>) {
  const { busy, injectedAddress, loginInjected } = useApp();
  return (
    <Modal open={open} onClose={onClose} title="Connect a wallet">
      <button
        onClick={() => void loginInjected()}
        disabled={busy}
        className="group flex w-full cursor-pointer items-center gap-4 border border-line bg-bg px-4 py-3.5 text-left transition-colors duration-150 hover:border-lime/60 disabled:cursor-wait disabled:opacity-60"
      >
        <Puzzle
          className="size-5 text-muted transition-colors group-hover:text-lime"
          aria-hidden
        />
        <span className="flex-1">
          <span className="block font-mono text-[13px] uppercase tracking-[0.05em]">
            {injectedAddress
              ? "Sign in with connected wallet"
              : "Browser extension wallet"}
          </span>
          <span className="block font-mono text-[11.5px] text-faint">
            {busy
              ? "Waiting for wallet approval"
              : injectedAddress
                ? `${injectedAddress.slice(0, 8)}…${injectedAddress.slice(-6)} · signature required`
                : "Connect an injected EVM wallet in this browser"}
          </span>
        </span>
        {busy && (
          <Loader2 className="size-4 animate-spin text-lime" aria-hidden />
        )}
      </button>
      <p className="mt-5 font-mono text-[12px] leading-relaxed text-faint">
        ZKBLAST only requests a login signature. It never asks for a seed phrase
        or private key.
      </p>
    </Modal>
  );
}
