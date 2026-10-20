"use client";

import { Check, CircleCheck, Copy, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PublicConfig } from "@/types/application";
import {
  transactionSuccessEvent,
  type TransactionSuccess,
} from "@/lib/transaction-success";
import { Modal } from "../ui/Modal";

export function TransactionSuccessModal({
  config,
}: {
  config: PublicConfig | null;
}) {
  const [queue, setQueue] = useState<TransactionSuccess[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    const receive = (event: Event) => {
      const next = (event as CustomEvent<TransactionSuccess>).detail;
      if (!next || !/^0x[\da-f]{64}$/iu.test(next.hash)) return;
      setQueue((current) =>
        current.some(
          (item) => item.hash === next.hash && item.chainId === next.chainId,
        )
          ? current
          : [...current, next],
      );
    };
    window.addEventListener(transactionSuccessEvent, receive);
    return () => window.removeEventListener(transactionSuccessEvent, receive);
  }, []);
  const close = useCallback(() => {
    setQueue((current) => current.slice(1));
    setCopyError(false);
  }, []);
  const current = queue[0];
  const network =
    current && config?.chainId === current.chainId ? config : null;
  async function copyHash() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.hash);
      setCopied(current.hash);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <Modal
      open={Boolean(current)}
      onClose={close}
      title="Transaction successful"
      width="max-w-lg"
    >
      {current && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <CircleCheck className="size-10 shrink-0 text-lime" aria-hidden />
            <div>
              <p className="text-lg font-medium">{current.action} confirmed</p>
              <p className="mt-1 text-sm text-muted">
                Your transaction was successfully included onchain.
              </p>
            </div>
          </div>
          <dl className="space-y-3 border-y border-line py-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Network</dt>
              <dd>
                {network
                  ? `${network.chainName} · ${network.environment}`
                  : `Chain ${current.chainId}`}
              </dd>
            </div>
            {current.blockNumber && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Block</dt>
                <dd className="font-mono">
                  {BigInt(current.blockNumber).toString()}
                </dd>
              </div>
            )}
            {current.gasUsed && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Gas used</dt>
                <dd className="font-mono">
                  {BigInt(current.gasUsed).toString()}
                </dd>
              </div>
            )}
          </dl>
          <div>
            <p className="label mb-2">Transaction hash</p>
            <p className="select-all break-all border border-line bg-bg p-3 font-mono text-xs leading-6">
              {current.hash}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void copyHash()}
              className="flex min-h-10 items-center justify-center gap-2 border border-line px-4 text-sm hover:bg-raised"
            >
              {copied === current.hash ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied === current.hash ? "Copied" : "Copy hash"}
            </button>
            {network && (
              <a
                href={`${network.explorerUrl.replace(/\/$/u, "")}/tx/${current.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-10 items-center justify-center gap-2 bg-lime px-4 text-sm text-lime-ink"
              >
                View on explorer <ExternalLink className="size-4" aria-hidden />
              </a>
            )}
          </div>
          {copyError && (
            <p role="status" className="text-sm text-muted">
              Copy unavailable. Select the transaction hash above to copy it
              manually.
            </p>
          )}
          <button
            type="button"
            onClick={close}
            className="w-full border border-line py-3 font-mono text-xs uppercase hover:bg-raised"
          >
            {queue.length > 1
              ? `Next confirmation (${queue.length - 1})`
              : "Done"}
          </button>
        </div>
      )}
    </Modal>
  );
}
