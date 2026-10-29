"use client";

import { useEffect, useMemo, useState } from "react";
import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import type { PrivateProverReleaseV2 } from "@zkblast/config";
import { privateVaultV2Abi } from "@zkblast/abi";
import type { NoteScopeV2, StoredNoteV2 } from "@/lib/notecrypto-v2";
import type {
  PrivateJournalV2,
  PrivateIntentV2,
} from "@/lib/private-v2-journal";
import type { ProtocolExecutionPool } from "@/types/application";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import { preparePrivateActionV2 } from "@/lib/private-v2-plan";
import {
  executePrivateIntentV2,
  privateIntentStateV2,
  assertNoteUnreservedV2,
  assertPrivateIntentNotesV2,
} from "@/lib/private-v2-recovery";
import { decodeActionStatementV2 } from "@/lib/private-v2-intent";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { ProtocolPairLogo } from "@/components/markets/MarketPairLogo";
import { ShieldedTokenLogo } from "./ShieldedTokenLogo";

const inputClass =
  "w-full min-w-0 border border-line bg-bg px-3 py-3 text-sm focus:border-line-strong focus:outline-none";
type Operation = "reserve" | "settle" | "refund";
export type PrivateActionV2 = "swap" | "add" | "remove";

export function PrivateActionsV2Panel({
  scope,
  manifest,
  journal,
  pool,
  poolSupported,
  onRequestDeposit,
  action,
  busy,
  backupSaved,
  save,
  run,
  onStage,
  onSubmitted,
}: {
  scope: NoteScopeV2;
  manifest: PrivateProverReleaseV2;
  journal: PrivateJournalV2;
  pool: ProtocolExecutionPool | null;
  poolSupported: boolean;
  onRequestDeposit: () => void;
  action: PrivateActionV2;
  busy: boolean;
  backupSaved: boolean;
  save: (next: PrivateJournalV2) => Promise<PrivateJournalV2>;
  run: (work: () => Promise<void>) => Promise<void>;
  onStage: (stage: string) => void;
  onSubmitted: (
    hash: Hex,
    operation: Operation,
    commitment: string,
  ) => Promise<void>;
}) {
  const { address, config, connect } = useApp();
  const markets = useExternalMarkets();
  const [selection0, setSelection0] = useState("");
  const [selection1, setSelection1] = useState("");
  const [bin, setBin] = useState("0");
  const [states, setStates] = useState<Record<string, string>>({});
  const [insertedNotes, setInsertedNotes] = useState<Record<string, boolean>>(
    {},
  );
  useEffect(() => {
    setSelection0("");
    setSelection1("");
  }, [action]);
  const activeIntentIds = useMemo(
    () =>
      journal.intents
        .filter(
          (intent) =>
            intent.reservationProof &&
            !journal.archivedIntents.includes(intent.id),
        )
        .map((intent) => intent.id),
    [journal.archivedIntents, journal.intents],
  );
  const statusScope = useMemo(
    () => scope,
    [scope.chainId, scope.environment, scope.settlement, scope.treeVersion],
  );
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider || activeIntentIds.length === 0) return;
    let active = true;
    setStates((current) => ({
      ...current,
      ...Object.fromEntries(
        activeIntentIds
          .filter((id) => current[id] === undefined)
          .map((id) => [id, "checking"]),
      ),
    }));
    void Promise.all(
      activeIntentIds.map(async (id) => {
        try {
          return [
            id,
            await privateIntentStateV2(provider, statusScope, id as Hex),
          ] as const;
        } catch {
          return [id, "unavailable"] as const;
        }
      }),
    ).then((entries) => {
      if (active)
        setStates((current) => ({
          ...current,
          ...Object.fromEntries(entries),
        }));
    });
    return () => {
      active = false;
    };
  }, [activeIntentIds, statusScope]);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider || journal.notes.length === 0) return;
    let active = true;
    void Promise.all(
      journal.notes.map(async (note) => {
        try {
          const data = (await provider.request({
            method: "eth_call",
            params: [
              {
                to: statusScope.settlement,
                data: encodeFunctionData({
                  abi: privateVaultV2Abi,
                  functionName: "commitmentInserted",
                  args: [note.commitment as Hex],
                }),
              },
              "latest",
            ],
          })) as Hex;
          return [
            note.commitment,
            decodeFunctionResult({
              abi: privateVaultV2Abi,
              functionName: "commitmentInserted",
              data,
            }),
          ] as const;
        } catch {
          return [note.commitment, false] as const;
        }
      }),
    ).then((entries) => {
      if (active) setInsertedNotes(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [address, journal.notes, states, statusScope]);
  const notesChecking = journal.notes.some(
    (note) => insertedNotes[note.commitment] === undefined,
  );
  const available = journal.notes.filter(
    (note) =>
      insertedNotes[note.commitment] === true &&
      !journal.intents.some(
        (intent) =>
          !journal.archivedIntents.includes(intent.id) &&
          intent.inputs.includes(note.commitment),
      ),
  );
  const tokenNotes = available.filter(
    (note) =>
      note.resource.kind === "token" &&
      pool &&
      [
        pool.token0Address.toLowerCase(),
        pool.token1Address.toLowerCase(),
      ].includes(note.resource.address.toLowerCase()),
  );
  const lpNotes = available.filter(
    (note) =>
      note.resource.kind === "lp" &&
      pool &&
      note.resource.address.toLowerCase() === pool.address.toLowerCase() &&
      note.resource.model === pool.model,
  );
  const token0Notes = tokenNotes.filter(
    (note) =>
      note.resource.kind === "token" &&
      note.resource.address.toLowerCase() ===
        pool?.token0Address.toLowerCase(),
  );
  const token1Notes = tokenNotes.filter(
    (note) =>
      note.resource.kind === "token" &&
      note.resource.address.toLowerCase() ===
        pool?.token1Address.toLowerCase(),
  );
  const selectedInputNote = tokenNotes.find(
    (note) => note.commitment === selection0,
  );
  const inputIsToken1 = Boolean(
    selectedInputNote?.resource.kind === "token" &&
      pool &&
      selectedInputNote.resource.address.toLowerCase() ===
        pool.token1Address.toLowerCase(),
  );
  const inputSymbol = pool
    ? inputIsToken1
      ? pool.token1Symbol
      : pool.token0Symbol
    : "Token";
  const outputSymbol = pool
    ? inputIsToken1
      ? pool.token0Symbol
      : pool.token1Symbol
    : "Token";
  const selectableNotes =
    action === "remove"
      ? lpNotes
      : action === "add"
        ? token0Notes
        : tokenNotes;
  const missingRequiredNotes =
    action === "remove"
      ? lpNotes.length === 0
      : action === "add"
        ? token0Notes.length === 0 || token1Notes.length === 0
        : tokenNotes.length === 0;
  const readinessMessage = !pool
    ? "Select an executable market from Markets."
    : !poolSupported
      ? "This pair is not enabled for Shielded execution."
      : !address
        ? "Connect and sign in with your wallet to continue."
        : notesChecking
          ? "Checking which private notes are available onchain…"
          : missingRequiredNotes
          ? action === "remove"
            ? "Add private liquidity first to create an LP note."
            : `Deposit ${pool.token0Symbol} or ${pool.token1Symbol} privately first.`
          : !selection0
            ? "Select the private note you want to spend."
            : action === "add" && !selection1
              ? `Select a ${pool.token1Symbol} private note.`
              : null;
  const optionLabel = (note: StoredNoteV2) => {
    const symbol =
      note.resource.kind === "lp"
        ? `LP shares · bin ${note.resource.binId}`
        : note.resource.address.toLowerCase() ===
            pool?.token0Address.toLowerCase()
          ? pool.token0Symbol
          : pool?.token1Symbol;
    const amount =
      note.resource.kind === "lp"
        ? `${note.amount} shares`
        : formatUnits(
            BigInt(note.amount),
            note.resource.address.toLowerCase() ===
              pool?.token0Address.toLowerCase()
              ? (pool?.token0Decimals ?? 18)
              : (pool?.token1Decimals ?? 18),
          );
    return `${symbol} · ${amount} · ${note.commitment.slice(0, 8)}…`;
  };
  const prepare = () =>
    run(async () => {
      if (!window.ethereum || !address || !pool)
        throw new Error("SELECT_MARKET_AND_CONNECT_WALLET");
      if (!poolSupported)
        throw new Error("This market is not enabled for private execution.");
      const selected =
        action === "add" ? [selection0, selection1] : [selection0];
      const inputNotes = selected.map((commitment) =>
        available.find((note) => note.commitment === commitment),
      );
      if (
        inputNotes.some((note) => !note) ||
        new Set(selected).size !== selected.length
      )
        throw new Error("SELECT_VALID_PRIVATE_NOTES");
      if (
        pool.model === "dlmm" &&
        action !== "swap" &&
        !/^-?(0|[1-9][0-9]{0,7})$/u.test(bin)
      )
        throw new Error("INVALID_V2_BIN");
      const prepared = await preparePrivateActionV2({
        scope,
        manifest,
        pool,
        action,
        binId: pool.model === "damm" || action === "swap" ? 0 : Number(bin),
        inputNotes: inputNotes as StoredNoteV2[],
        provider: window.ethereum,
        account: address as Address,
        quoter: config?.contracts?.find(
          (contract) => contract.name === "PoolQuoter",
        )?.address,
        onStage,
      });
      await save({
        ...journal,
        notes: [...journal.notes, ...prepared.notes],
        intents: [...journal.intents, prepared.intent],
      });
      setSelection0("");
      setSelection1("");
      onStage(
        "Private transaction prepared. Save recovery once, then continue to your wallet.",
      );
    });
  const refresh = (intent: PrivateIntentV2) =>
    run(async () => {
      if (!window.ethereum) throw new Error("CONNECT_WALLET");
      const state = await privateIntentStateV2(
        window.ethereum,
        scope,
        intent.id as Hex,
      );
      setStates((current) => ({ ...current, [intent.id]: state }));
    });
  const execute = (intent: PrivateIntentV2, operation: Operation) =>
    run(async () => {
      if (!window.ethereum || !address) throw new Error("CONNECT_WALLET");
      if (operation === "reserve" && !backupSaved)
        throw new Error("DOWNLOAD_ENCRYPTED_JOURNAL_FIRST");
      onStage(`Confirm private ${operation} in your wallet`);
      const hash = await executePrivateIntentV2({
        notes: journal.notes,
        manifest,
        operation,
        intent,
        scope,
        provider: window.ethereum,
        account: address as Address,
        onSubmitted: (hash) => onSubmitted(hash, operation, intent.inputs[0]),
      });
      setStates((current) => ({
        ...current,
        [intent.id]:
          operation === "reserve"
            ? "pending"
            : operation === "settle"
              ? "settled"
              : "refunded",
      }));
      onStage(`Confirmed: ${hash}`);
    });
  const archive = (intent: PrivateIntentV2) =>
    run(async () => {
      if (!window.ethereum) throw new Error("CONNECT_WALLET");
      await assertPrivateIntentNotesV2(intent, journal.notes, manifest, scope);
      if (
        (await privateIntentStateV2(
          window.ethereum,
          scope,
          intent.id as Hex,
        )) !== "unsubmitted"
      )
        throw new Error("V2_ONLY_UNSUBMITTED_DRAFTS_CAN_BE_ARCHIVED");
      for (const commitment of intent.inputs) {
        const note = journal.notes.find(
          (candidate) => candidate.commitment === commitment,
        );
        if (!note) throw new Error("V2_INPUT_NOTE_MISSING");
        await assertNoteUnreservedV2(window.ethereum, note, manifest);
      }
      await save({
        ...journal,
        archivedIntents: [...new Set([...journal.archivedIntents, intent.id])],
      });
      onStage(
        "Unsubmitted draft archived without deleting its recovery notes. Chain spend locks always apply.",
      );
    });
  return (
    <div className="grid min-w-0 max-w-full gap-4 overflow-x-hidden">
      {pool ? (
        <div className="flex min-w-0 items-center gap-3">
          <ProtocolPairLogo
            base={pool.token0Symbol}
            quote={pool.token1Symbol}
            markets={markets.items}
          />
          <div className="min-w-0">
            <p className="font-mono text-xs">
              {pool.model.toUpperCase()} · {pool.token0Symbol}/
              {pool.token1Symbol}
            </p>
            <p className="mt-1 text-xs text-muted">Private execution</p>
            <p className="mt-1 text-[10px] text-faint">
              Change the pair from Markets to access another Shielded-enabled
              pool.
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Select a market to continue.</p>
      )}
      {!poolSupported && pool && (
        <p className="text-xs text-warn">
          This pair is visible publicly but is not enabled for Shielded
          execution yet.
        </p>
      )}
      {pool?.model === "dlmm" && action === "add" && (
        <label className="grid gap-2">
          DLMM bin ID
          <input
            className={inputClass}
            inputMode="numeric"
            value={bin}
            onChange={(event) => setBin(event.target.value)}
            disabled={busy}
          />
        </label>
      )}
      <label className="grid gap-2 border border-line bg-bg/80 p-3">
        <span className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>
            {action === "remove"
              ? "Private LP position"
              : action === "add"
                ? "Deposit first token"
                : "You pay"}
          </span>
          {action !== "remove" && pool && (
            <span className="flex items-center gap-2 text-foreground">
              <ShieldedTokenLogo
                symbol={inputSymbol}
                markets={markets.items}
                className="size-7"
              />
              {inputSymbol}
            </span>
          )}
        </span>
        <select
          className={inputClass}
          value={selection0}
          onChange={(event) => {
            setSelection0(event.target.value);
            const note = journal.notes.find(
              (candidate) => candidate.commitment === event.target.value,
            );
            if (action === "remove" && note?.resource.kind === "lp")
              setBin(note.resource.binId ?? "0");
          }}
          disabled={busy}
        >
          <option value="">Select a note</option>
          {selectableNotes.map((note) => (
            <option key={note.commitment} value={note.commitment}>
              {optionLabel(note)}
            </option>
          ))}
        </select>
      </label>
      {action === "add" && (
        <label className="grid gap-2 border border-line bg-bg/80 p-3">
          <span className="flex items-center justify-between gap-3 text-xs text-muted">
            <span>Deposit paired token</span>
            {pool && (
              <span className="flex items-center gap-2 text-foreground">
                <ShieldedTokenLogo
                  symbol={pool.token1Symbol}
                  markets={markets.items}
                  className="size-7"
                />
                {pool.token1Symbol}
              </span>
            )}
          </span>
          <select
            className={inputClass}
            value={selection1}
            onChange={(event) => setSelection1(event.target.value)}
            disabled={busy}
          >
            <option value="">Select the other token</option>
            {token1Notes
              .map((note) => (
                <option key={note.commitment} value={note.commitment}>
                  {optionLabel(note)}
                </option>
              ))}
          </select>
        </label>
      )}
      {action === "swap" && (
        <div className="grid gap-2 border border-line bg-bg/80 p-3">
          <span className="flex items-center justify-between gap-3 text-xs text-muted">
            <span>You receive privately</span>
            {pool && (
              <span className="flex items-center gap-2 text-foreground">
                <ShieldedTokenLogo
                  symbol={outputSymbol}
                  markets={markets.items}
                  className="size-7"
                />
                {outputSymbol}
              </span>
            )}
          </span>
          <span className="font-mono text-sm text-muted">
            {selection0
              ? "The protected output is fixed during local proof generation."
              : "Select a private note to calculate the protected output."}
          </span>
        </div>
      )}
      {readinessMessage && (
        <p className="text-xs leading-relaxed text-muted" role="status">
          {readinessMessage}
        </p>
      )}
      <Button
        onClick={() => {
          if (!address) connect();
          else if (notesChecking) return;
          else if (missingRequiredNotes) onRequestDeposit();
          else void prepare();
        }}
        disabled={
          busy ||
          !pool ||
          !poolSupported ||
          notesChecking ||
          Boolean(
            address &&
              !missingRequiredNotes &&
              (!selection0 || (action === "add" && !selection1)),
          )
        }
      >
        {!address
          ? "Connect wallet"
          : notesChecking
            ? "Checking private notes…"
          : missingRequiredNotes
            ? action === "remove"
              ? "Add private liquidity first"
              : "Deposit private tokens first"
            : `Prepare ${
                action === "swap"
                  ? "swap"
                  : action === "add"
                    ? "liquidity"
                    : "removal"
              }`}
      </Button>
      <div className="grid min-w-0 max-w-full gap-4 border-t border-line pt-4">
        <h4>Prepared transactions</h4>
        {!journal.intents.length && (
          <p className="text-xs text-muted">
            Your prepared transaction will appear here. Save the encrypted
            recovery file before submitting it.
          </p>
        )}
        {journal.intents.map((intent, index) => {
          if (!intent.reservationProof)
            return (
              <p key={intent.id} className="text-xs text-muted">
                Intent {index + 1}: no executable reservation proof saved.
              </p>
            );
          const decoded = decodeActionStatementV2(intent.statement, scope);
          const intentState = states[intent.id] ?? "checking";
          return (
            <section
              key={intent.id}
              className="grid min-w-0 gap-3 border border-line p-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span>
                  {intent.action} · intent {index + 1}
                </span>
                <span className="shrink-0 border border-line px-2 py-1 font-mono text-[10px] uppercase text-muted">
                  {intentState === "checking"
                    ? "Checking…"
                    : intentState === "unavailable"
                      ? "Refresh needed"
                      : intentState}
                </span>
              </div>
              <p className="min-w-0 max-w-full font-mono text-[10px] text-muted [overflow-wrap:anywhere]">
                {intent.id}
              </p>
              <p className="text-xs text-muted">
                Deadline:{" "}
                {new Date(
                  Number(decoded.terms.deadline) * 1000,
                ).toLocaleString()}
              </p>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void refresh(intent)}
              >
                Refresh status
              </Button>
              {intentState === "unsubmitted" &&
                !journal.archivedIntents.includes(intent.id) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void archive(intent)}
                  >
                    Archive unsubmitted draft
                  </Button>
                )}
              {intentState === "unsubmitted" && !backupSaved && (
                <p className="text-xs leading-relaxed text-muted">
                  Save the recovery checkpoint above to enable submission.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    !backupSaved ||
                    journal.archivedIntents.includes(intent.id) ||
                    intentState !== "unsubmitted"
                  }
                  onClick={() => void execute(intent, "reserve")}
                >
                  1. Submit
                </Button>
                <Button
                  size="sm"
                  disabled={busy || intentState !== "pending"}
                  onClick={() => void execute(intent, "settle")}
                >
                  2. Complete
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="col-span-2 w-full"
                  disabled={busy || intentState !== "pending"}
                  onClick={() => void execute(intent, "refund")}
                >
                  Recover expired
                </Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
