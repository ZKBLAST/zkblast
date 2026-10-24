"use client";

import { useEffect, useId, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  fetchPrivateProverV2,
  type PrivateProverReleaseV2,
} from "@zkblast/config";
import { parseUnits, type Address } from "viem";
import { useApp } from "@/components/shell/AppProvider";
import { Button } from "@/components/ui/Button";
import type { ProtocolExecutionPool } from "@/types/application";
import { useExternalMarkets } from "@/lib/use-external-markets";
import { download } from "@/lib/notecrypto";
import {
  encryptPrivatePayloadV2,
  type NoteScopeV2,
  type StoredNoteV2,
} from "@/lib/notecrypto-v2";
import {
  decryptJournalV2,
  emptyJournalV2,
  journalStorageKeyV2,
  persistJournalV2,
  privateJournalUnlockError,
  type PrivateJournalV2,
} from "@/lib/private-v2-journal";
import {
  calculatePrivateNoteV2,
  createPrivateNoteV2,
} from "@/lib/private-v2-notes";
import { fundPrivateNoteV2 } from "@/lib/private-v2-funding";
import { assertNoteUnreservedV2 } from "@/lib/private-v2-recovery";
import { publishPrivateV2SessionSummary } from "@/lib/private-v2-session-summary";
import {
  PrivateActionsV2Panel,
  type PrivateActionV2,
} from "./PrivateActionsV2Panel";
import { ShieldedTokenLogo } from "./ShieldedTokenLogo";

const inputClass =
  "w-full min-w-0 border border-line bg-bg px-3 py-3 text-sm focus:border-line-strong focus:outline-none";
type PrivateFlow = "deposit" | PrivateActionV2 | "withdraw";

export function PrivateVaultV2Panel({
  pool,
  onBusyChange,
}: {
  pool: ProtocolExecutionPool | null;
  onBusyChange: (busy: boolean) => void;
}) {
  const { config } = useApp();
  const v2 = config?.shieldedV2;
  if (!config || !v2?.proverRelease)
    return (
      <p className="p-5 text-sm leading-relaxed text-muted" role="status">
        Private trading v2 is waiting for its isolated network vault and
        verified prover release. Your existing USDG notes remain available in
        the vault tab.
      </p>
    );
  const scope: NoteScopeV2 = {
    environment: config.environment,
    chainId: String(config.chainId),
    settlement: v2.vault as Address,
    treeVersion: String(v2.treeVersion),
  };
  return (
    <PrivateVaultV2Session
      key={`${scope.chainId}:${scope.settlement}:${scope.treeVersion}:${v2.proverRelease.manifestSha256}`}
      scope={scope}
      reference={v2.proverRelease}
      pool={pool}
      onBusyChange={onBusyChange}
    />
  );
}

function PrivateVaultV2Session({
  scope,
  reference,
  pool,
  onBusyChange,
}: {
  scope: NoteScopeV2;
  reference: { manifestPath: string; manifestSha256: string };
  pool: ProtocolExecutionPool | null;
  onBusyChange: (busy: boolean) => void;
}) {
  const { address, config } = useApp();
  const markets = useExternalMarkets();
  const [manifest, setManifest] = useState<PrivateProverReleaseV2 | null>(null);
  const [journal, setJournal] = useState<PrivateJournalV2 | null>(null);
  const [savedJournalFound, setSavedJournalFound] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [flow, setFlow] = useState<PrivateFlow>("deposit");
  const [assetIndex, setAssetIndex] = useState("0");
  const [amount, setAmount] = useState("");
  const [selectedNote, setSelectedNote] = useState("");
  const [backupSaved, setBackupSaved] = useState(false);
  const [lastSubmittedHash, setLastSubmittedHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const id = useId();
  useEffect(() => {
    let active = true;
    void fetchPrivateProverV2(scope, reference)
      .then((release) => {
        if (active) setManifest(release);
      })
      .catch(() => {
        if (active)
          setStatus(
            "Unable to validate the network prover release. No transaction is enabled.",
          );
      });
    return () => {
      active = false;
    };
    // Scope and reference are immutable for this keyed session.
  }, []);
  useEffect(() => {
    setSavedJournalFound(
      localStorage.getItem(journalStorageKeyV2(scope)) !== null,
    );
    // This session is keyed by its immutable network scope.
  }, []);
  useEffect(() => {
    publishPrivateV2SessionSummary(journal);
    return () => publishPrivateV2SessionSummary(null);
  }, [journal]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    onBusyChange(true);
    setStatus("");
    try {
      await work();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "PRIVATE_V2_OPERATION_FAILED",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  const verify = async (note: StoredNoteV2) => {
    if (!manifest) throw new Error("V2_PROVER_NOT_READY");
    return (
      (await calculatePrivateNoteV2(note, manifest)).commitment ===
      note.commitment
    );
  };
  const save = async (
    next: PrivateJournalV2,
    recoveryChanged = true,
  ) => {
    if (!navigator.locks) throw new Error("V2_BROWSER_LOCKS_REQUIRED");
    const merged = await persistJournalV2(next, passphrase, scope, {
      storage: localStorage,
      verify,
      lock: async <T,>(name: string, work: () => Promise<T>): Promise<T> => {
        let result!: T;
        await navigator.locks.request(name, async () => {
          result = await work();
        });
        return result;
      },
    });
    setJournal(merged);
    setSavedJournalFound(true);
    if (recoveryChanged) setBackupSaved(false);
    return merged;
  };
  const unlock = () =>
    run(async () => {
      if (!manifest) throw new Error("V2_PROVER_NOT_READY");
      if (passphrase.length < 12)
        throw new Error("Use a passphrase of at least 12 characters.");
      const serialized = localStorage.getItem(journalStorageKeyV2(scope));
      let next: PrivateJournalV2;
      try {
        next = serialized
          ? await decryptJournalV2(serialized, passphrase, scope, verify)
          : emptyJournalV2();
      } catch (error) {
        throw new Error(privateJournalUnlockError(error));
      }
      setJournal(next);
      setSavedJournalFound(Boolean(serialized));
      setStatus("Private journal unlocked in this browser.");
    });
  const assetPolicy = config?.shieldedV2?.assets;
  const configuredAssets = new Map(
    (assetPolicy ?? []).map((asset) => [
      asset.address.toLowerCase(),
      asset,
    ]),
  );
  const poolAssets = pool
    ? [
        {
          address: pool.token0Address as Address,
          symbol: pool.token0Symbol,
          decimals: pool.token0Decimals,
        },
        {
          address: pool.token1Address as Address,
          symbol: pool.token1Symbol,
          decimals: pool.token1Decimals,
        },
      ]
    : [];
  const assets = assetPolicy
    ? assetPolicy.filter((asset) => asset.enabled)
    : poolAssets;
  const selectedAsset = assets[Number(assetIndex)];
  const unsupportedPool =
    assetPolicy !== undefined &&
    pool !== null &&
    poolAssets.some(
      (asset) => !configuredAssets.get(asset.address.toLowerCase())?.enabled,
    );
  const recoveryPrepared = Boolean(
    journal && (journal.notes.length > 0 || journal.intents.length > 0),
  );
  const prepare = () =>
    run(async () => {
      const asset = assets[Number(assetIndex)];
      if (!journal || !manifest || !asset)
        throw new Error("SELECT_A_MARKET_AND_UNLOCK_JOURNAL");
      if (
        !/^\d+(?:\.\d+)?$/u.test(amount) ||
        (amount.split(".")[1]?.length ?? 0) > asset.decimals
      )
        throw new Error("INVALID_TOKEN_AMOUNT");
      const note = await createPrivateNoteV2(
        scope,
        { kind: "token", address: asset.address as Address },
        String(parseUnits(amount, asset.decimals)),
        "input",
        manifest,
      );
      await save({ ...journal, notes: [...journal.notes, note] });
      setSelectedNote(note.commitment);
      setStatus(
        "Deposit prepared. Save recovery once, then continue to your wallet.",
      );
    });
  const exportBackup = () =>
    run(async () => {
      if (!journal) return;
      download(
        `zkblast-private-v2-${scope.chainId}-journal.json`,
        await encryptPrivatePayloadV2(journal, passphrase, scope, "journal"),
      );
      setBackupSaved(true);
      setStatus(
        "Recovery saved. You can continue to the wallet step.",
      );
    });
  const restore = (file: File) =>
    run(async () => {
      if (file.size > 2_000_000) throw new Error("V2_BACKUP_TOO_LARGE");
      const restored = await decryptJournalV2(
        await file.text(),
        passphrase,
        scope,
        verify,
      );
      await save(restored);
      setStatus("Validated journal merged. No existing notes were removed.");
    });
  const submit = () =>
    run(async () => {
      const note = journal?.notes.find(
        (candidate) => candidate.commitment === selectedNote,
      );
      if (!journal || !manifest || !note || !address || !window.ethereum)
        throw new Error("CONNECT_WALLET_AND_SELECT_NOTE");
      if (!backupSaved) throw new Error("DOWNLOAD_ENCRYPTED_JOURNAL_FIRST");
      await assertNoteUnreservedV2(window.ethereum, note, manifest);
      const operation = flow === "withdraw" ? "withdraw" : "deposit";
      if (
        operation === "deposit" &&
        journal.transactions.some(
          (transaction) =>
            transaction.operation === "deposit" &&
            transaction.commitment === note.commitment,
        )
      )
        throw new Error("V2_DEPOSIT_ALREADY_SUBMITTED_CHECK_EXPLORER");
      const hash = await fundPrivateNoteV2({
        operation,
        note,
        manifest,
        account: address as Address,
        provider: window.ethereum,
        onStage: setStatus,
        onSubmitted: async (hash) => {
          setLastSubmittedHash(hash);
          setStatus(`Submitted: ${hash}`);
          await save(
            {
              ...journal,
              transactions: [
                ...journal.transactions,
                { hash, operation, commitment: note.commitment },
              ],
            },
            false,
          );
        },
      });
      setStatus(`Confirmed: ${hash}`);
    });
  return (
    <div className="grid min-w-0 max-w-full gap-5 overflow-x-hidden p-4 text-sm">
      <div>
        <h3 className="text-base">Private vault v2</h3>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {scope.environment === "mainnet" ? "Mainnet" : "Testnet"} · separate
          notes and recovery journal. Existing USDG vault notes are not imported
          or changed.
        </p>
      </div>
      {!journal ? (
        <div className="grid gap-3">
          <label htmlFor={`${id}-unlock`}>Journal passphrase</label>
          {savedJournalFound && (
            <p className="text-xs leading-relaxed text-muted">
              A saved journal was found in this browser. Enter the same
              passphrase used when it was created.
            </p>
          )}
          <input
            id={`${id}-unlock`}
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={passphrase}
            onChange={(event) => {
              setPassphrase(event.target.value);
              setStatus("");
            }}
            disabled={busy}
          />
          <Button onClick={() => void unlock()} disabled={busy || !manifest}>
            Unlock / create journal
          </Button>
          {status && (
            <p
              role="alert"
              aria-live="assertive"
              className="text-xs leading-relaxed text-danger"
            >
              {status}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              {journal.notes.length} notes · {journal.intents.length} intents
            </span>
            <button
              type="button"
              className="underline underline-offset-4"
              disabled={busy}
              onClick={() => {
                setJournal(null);
                setPassphrase("");
                setSelectedNote("");
                setBackupSaved(false);
                setStatus("");
              }}
            >
              Lock journal
            </button>
          </div>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.14em] text-muted">
              I want to
            </span>
            <select
              className={inputClass}
              value={flow}
              disabled={busy}
              onChange={(event) => {
                setFlow(event.target.value as PrivateFlow);
                setSelectedNote("");
                setStatus("");
              }}
            >
              <option value="deposit">Deposit privately</option>
              <option value="swap">Swap privately</option>
              <option value="add">Add private liquidity</option>
              <option value="remove">Remove private liquidity</option>
              <option value="withdraw">Withdraw to wallet</option>
            </select>
          </label>
          <section className="grid gap-3 border border-line bg-panel/40 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm">Recovery checkpoint</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Prepare first, then save once before submitting to your
                  wallet.
                </p>
              </div>
              {backupSaved && (
                <span className="shrink-0 text-xs text-foreground">Saved</span>
              )}
            </div>
            <Button
              onClick={() => void exportBackup()}
              disabled={busy || backupSaved || !recoveryPrepared}
            >
              <Download className="size-4" aria-hidden />
              {backupSaved
                ? "Recovery up to date"
                : "Save recovery & continue"}
            </Button>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">
                Restore an existing recovery file
              </summary>
              <label className="mt-3 grid gap-3 border-t border-line pt-3">
                <span className="flex items-center gap-2">
                  <Upload className="size-4" aria-hidden /> Choose encrypted file
                </span>
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  className="min-w-0 max-w-full text-xs"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void restore(file);
                  }}
                />
              </label>
            </details>
          </section>
          {flow === "deposit" && (
            <div className="grid gap-3">
              <div className="border border-line bg-bg/80 p-3">
                <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
                  <label htmlFor={`${id}-amount`}>You deposit privately</label>
                  <span>{assets.length} enabled tokens</span>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <input
                    id={`${id}-amount`}
                    className="w-full min-w-0 bg-transparent font-mono text-xl outline-none"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={busy}
                  />
                  {selectedAsset && (
                    <ShieldedTokenLogo
                      symbol={selectedAsset.symbol}
                      markets={markets.items}
                      className="size-8"
                    />
                  )}
                  <select
                    id={`${id}-asset`}
                    aria-label="Private deposit token"
                    className="min-w-20 shrink-0 border border-line bg-bg px-2 py-2 font-mono text-xs focus:border-line-strong focus:outline-none"
                    value={assetIndex}
                    onChange={(event) => setAssetIndex(event.target.value)}
                    disabled={busy}
                  >
                    {assets.map((asset, index) => (
                      <option key={asset.address} value={index}>
                        {asset.symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <Button
                onClick={() => void prepare()}
                disabled={busy || !assets.length}
              >
                1. Prepare private deposit
              </Button>
            </div>
          )}
          {["swap", "add", "remove"].includes(flow) && manifest && (
            <PrivateActionsV2Panel
              scope={scope}
              manifest={manifest}
              journal={journal}
              pool={pool}
              poolSupported={!unsupportedPool}
              action={flow as PrivateActionV2}
              busy={busy}
              backupSaved={backupSaved}
              save={save}
              run={run}
              onStage={setStatus}
              onSubmitted={async (hash, operation, commitment) => {
                setLastSubmittedHash(hash);
                await save(
                  {
                    ...journal,
                    transactions: [
                      ...journal.transactions,
                      { hash, operation, commitment },
                    ],
                  },
                  false,
                );
              }}
            />
          )}
          {(flow === "deposit" || flow === "withdraw") && (
            <div className="grid gap-3">
              <label htmlFor={`${id}-note`}>Token note</label>
              <select
                id={`${id}-note`}
                className={inputClass}
                value={selectedNote}
                onChange={(event) => setSelectedNote(event.target.value)}
                disabled={busy}
              >
                <option value="">Select a note</option>
                {journal.notes
                  .filter((note) => note.resource.kind === "token")
                  .map((note, index) => (
                    <option key={note.commitment} value={note.commitment}>
                      Note {index + 1} · {note.amount} raw units · {note.role}
                    </option>
                  ))}
              </select>
              <Button
                onClick={() => void submit()}
                disabled={busy || !selectedNote || !backupSaved || !address}
              >
                {flow === "withdraw"
                  ? "Prove and withdraw"
                  : "2. Prove and deposit"}
              </Button>
            </div>
          )}
          {journal.transactions.length > 0 && (
            <details className="min-w-0 text-xs">
              <summary>Submitted transactions</summary>
              <ul className="mt-3 grid min-w-0 max-w-full gap-3">
                {journal.transactions.map((transaction) => (
                  <li
                    key={transaction.hash}
                    className="min-w-0 max-w-full [overflow-wrap:anywhere]"
                  >
                    <a
                      href={`${config?.explorerUrl}/tx/${transaction.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block min-w-0 max-w-full [overflow-wrap:anywhere] underline"
                    >
                      {transaction.operation}: {transaction.hash}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {lastSubmittedHash && (
        <a
          className="block min-w-0 max-w-full text-xs [overflow-wrap:anywhere] underline"
          target="_blank"
          rel="noreferrer"
          href={`${config?.explorerUrl}/tx/${lastSubmittedHash}`}
        >
          Last submitted transaction: {lastSubmittedHash}
        </a>
      )}
      {journal && (
        <p
          role="status"
          aria-live="polite"
          className="min-w-0 max-w-full text-xs leading-relaxed text-muted [overflow-wrap:anywhere]"
        >
          {busy ? status || "Working locally…" : status}
        </p>
      )}
    </div>
  );
}
