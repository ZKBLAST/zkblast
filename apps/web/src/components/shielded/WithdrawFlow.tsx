"use client";

import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { webPublicConfig } from "@/config/public-env";
import {
  executeShieldedWithdrawal,
  type WithdrawStage,
} from "@/lib/shielded-withdraw";
import type { ShieldedNoteV1 } from "@/lib/notecrypto";

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const stageLabel: Readonly<Record<WithdrawStage, string>> = {
  "syncing-root": "Syncing the accepted on-chain root",
  "building-witness": "Building the private witness locally",
  proving: "Generating the Groth16 proof in this browser",
  verifying: "Verifying the proof locally",
  submitting: "Waiting for the wallet and transaction receipt",
  confirmed: "Withdrawal confirmed on-chain",
};

type Props = Readonly<{
  notes: readonly ShieldedNoteV1[];
  onSpent: (note: ShieldedNoteV1) => void;
}>;

export function WithdrawFlow({ notes, onSpent }: Props) {
  const { address, connect, toast } = useApp();
  const unspent = useMemo(
    () => notes.filter((note) => note.status === "unspent"),
    [notes],
  );
  const [commitment, setCommitment] = useState("");
  const [recipient, setRecipient] = useState("");
  const [stage, setStage] = useState<WithdrawStage | null>(null);
  const [error, setError] = useState("");
  const note =
    unspent.find((item) => item.commitment === commitment) ?? unspent[0] ?? null;

  useEffect(() => {
    if (!commitment && unspent[0]) setCommitment(unspent[0].commitment);
  }, [commitment, unspent]);

  const submit = async () => {
    if (!address) return connect();
    if (!window.ethereum || !note || !addressPattern.test(recipient)) return;
    setError("");
    try {
      const spent = await executeShieldedWithdrawal(
        window.ethereum,
        webPublicConfig.apiUrl,
        address as `0x${string}`,
        recipient as `0x${string}`,
        note,
        setStage,
      );
      onSpent(spent);
      toast({
        kind: "success",
        title: "Shielded withdrawal confirmed",
        body: "The nullifier is now spent and this note cannot be reused.",
      });
    } catch (reason) {
      setStage(null);
      setError(reason instanceof Error ? reason.message : "WITHDRAW_FAILED");
    }
  };

  if (!unspent.length)
    return (
      <div className="border border-dashed border-line-strong p-6 text-center text-sm text-muted">
        No spendable note is loaded. Deposit a note or restore an encrypted
        backup first.
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="withdraw-note" className="text-sm text-faint">
          Spendable note
        </label>
        <select
          id="withdraw-note"
          value={note?.commitment ?? ""}
          disabled={stage !== null}
          onChange={(event) => setCommitment(event.target.value)}
          className="mt-2 h-12 w-full border border-line bg-bg px-3 font-mono text-xs"
        >
          {unspent.map((item) => (
            <option key={item.commitment} value={item.commitment}>
              leaf #{item.leafIndex} · {item.amountRaw} · {item.commitment.slice(0, 14)}…
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="withdraw-recipient" className="text-sm text-faint">
          Recipient address
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="withdraw-recipient"
            value={recipient}
            disabled={stage !== null}
            onChange={(event) => setRecipient(event.target.value.trim())}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 border border-line bg-bg px-3 font-mono text-sm"
          />
          {address && (
            <Button
              variant="secondary"
              disabled={stage !== null}
              onClick={() => setRecipient(address)}
            >
              Use mine
            </Button>
          )}
        </div>
      </div>
      {address && recipient.toLowerCase() === address.toLowerCase() && (
        <p className="flex gap-2 border border-warn/40 bg-warn/[0.05] p-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Using the same
          wallet as relayer and recipient can make activity easier to link.
        </p>
      )}
      {stage && (
        <div className="flex items-center gap-3 border border-lime/30 bg-lime/[0.04] p-4 text-sm">
          {stage === "confirmed" ? (
            <Check className="size-5 text-lime" />
          ) : (
            <LoaderCircle className="size-5 animate-spin text-lime" />
          )}
          <span>{stageLabel[stage]}</span>
        </div>
      )}
      <p className="text-xs leading-relaxed text-faint">
        Secret, nonce, Merkle path, and witness stay in this browser. The API
        returns only validated public commitment-tree data and never receives
        the note secret.
      </p>
      <Button
        size="lg"
        className="w-full"
        loading={stage !== null && stage !== "confirmed"}
        disabled={
          stage !== null || !note || (!!address && !addressPattern.test(recipient))
        }
        onClick={() => void submit()}
      >
        {!address ? "Connect wallet" : "Generate proof and withdraw"}
      </Button>
      {error && (
        <p role="alert" className="break-all text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
