"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, RefreshCw, ShieldCheck, Upload, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { fetchPrivateProverV2, type PrivateProverReleaseV2, type PrivatePerpsReleaseIndex } from "@zkblast/config";
import { privatePerpClaimLiquidatedPublicInputsV1, privatePerpClosePublicInputsV1, privatePerpModifyPublicInputsV1, privatePerpOpenPublicInputsV1 } from "@zkblast/sdk";
import type { Address } from "viem";
import { useApp } from "@/components/shell/AppProvider";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import {
  emptyPrivatePerpsJournal,
  decryptPrivatePerpsJournal,
  loadPrivatePerpsJournal,
  privatePerpsJournalError,
  savePrivatePerpsJournal,
  privatePerpsJournalKey,
  type PrivatePerpsJournal,
} from "@/lib/private-perps-journal";
import {
  calculatePrivatePerpsPosition,
  encodePrivatePerpsProof,
  loadPrivatePerpsRelease,
  provePrivatePerpsInBrowser,
} from "@/lib/private-perps-prover";
import { calculatePrivateNoteV2, createPrivateNoteV2 } from "@/lib/private-v2-notes";
import { decryptJournalV2, journalStorageKeyV2, persistJournalV2, replaceJournalV2, type PrivateJournalV2 } from "@/lib/private-v2-journal";
import { fetchPrivatePathV2 } from "@/lib/private-v2-path";
import type { NoteScopeV2, StoredNoteV2 } from "@/lib/notecrypto-v2";

type RelayStatus = Readonly<{
  requestId: `0x${string}`;
  status: "queued" | "processing" | "submitted" | "confirmed" | "failed" | "expired";
  transactionHash: string | null;
  errorCode: string | null;
}>;

function randomField(length: number): string {
  let value = 0n;
  while (value === 0n) {
    value = crypto.getRandomValues(new Uint8Array(length))
      .reduce((result, byte) => (result << 8n) | BigInt(byte), 0n);
  }
  return value.toString();
}

export function PrivatePerpsPanel({
  marketLabel,
  marketId,
  currentPriceX18,
  side,
  margin,
  leverage,
  maximumLeverage,
  onSideChange,
  onMarginChange,
  onLeverageChange,
}: Readonly<{
  marketLabel: string;
  marketId?: `0x${string}`;
  currentPriceX18: string | null;
  side: "long" | "short";
  margin: string;
  leverage: number;
  maximumLeverage: number;
  onSideChange: (side: "long" | "short") => void;
  onMarginChange: (margin: string) => void;
  onLeverageChange: (leverage: number) => void;
}>) {
  const { config } = useApp();
  const [passphrase, setPassphrase] = useState("");
  const [journal, setJournal] = useState<PrivatePerpsJournal | null>(null);
  const [releaseReady, setReleaseReady] = useState(false);
  const [release, setRelease] = useState<PrivatePerpsReleaseIndex | null>(null);
  const [noteRelease, setNoteRelease] = useState<PrivateProverReleaseV2 | null>(null);
  const [noteJournal, setNoteJournal] = useState<PrivateJournalV2 | null>(null);
  const [selectedNote, setSelectedNote] = useState("");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Readonly<Record<string, RelayStatus>>>({});
  const [residuals, setResiduals] = useState<Readonly<Record<string, string>>>({});
  const restoreInput = useRef<HTMLInputElement>(null);
  const scope = useMemo<NoteScopeV2 | null>(() => {
    if (!config?.perps || !config.shieldedV2) return null;
    return {
      environment: config.environment,
      chainId: String(config.chainId),
      settlement: config.perps.shieldedAdapter as `0x${string}`,
      treeVersion: String(config.shieldedV2.treeVersion),
    };
  }, [config]);
  const noteScope = useMemo<NoteScopeV2 | null>(() => {
    if (!config?.shieldedV2) return null;
    return {
      environment: config.environment,
      chainId: String(config.chainId),
      settlement: config.shieldedV2.vault as Address,
      treeVersion: String(config.shieldedV2.treeVersion),
    };
  }, [config]);

  useEffect(() => {
    if (!journal) return;
    const pending = journal.records.filter((record) =>
      record.relayRequestId && !["closed", "liquidated"].includes(record.status),
    );
    if (pending.length === 0) return;
    const controller = new AbortController();
    const refresh = async () => {
      const results = await Promise.allSettled(pending.map(async (record) => {
        const status = await apiRequest<RelayStatus>(
          webPublicConfig.apiUrl,
          `/v1/perps/private/relay/${record.relayRequestId}`,
          { signal: controller.signal },
        );
        return [record.relayRequestId!, status] as const;
      }));
      if (controller.signal.aborted) return;
      setStatuses((current) => Object.fromEntries([
        ...Object.entries(current),
        ...results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
      ]));
      const completed = new Map(results.flatMap((result) =>
        result.status === "fulfilled" && result.value[1].status === "confirmed"
          ? [result.value] : []));
      if (completed.size > 0 && scope) {
        const replaced = new Set(journal.records.flatMap((record) =>
          record.relayRequestId && completed.has(record.relayRequestId) && record.replacesCommitment
            ? [record.replacesCommitment] : []));
        const next: PrivatePerpsJournal = { ...journal, records: journal.records.map((record) => {
          const relay = record.relayRequestId ? completed.get(record.relayRequestId) : undefined;
          if (replaced.has(record.positionCommitment)) return { ...record, status: "closed" as const };
          if (!relay) return record;
          return {
            ...record,
            status: record.status === "closing" || record.status === "liquidated"
              ? "closed" as const : "open" as const,
            ...(relay.transactionHash ? { transactionHash: relay.transactionHash as `0x${string}` } : {}),
          };
        }) };
        if (JSON.stringify(next) !== JSON.stringify(journal)) {
          await savePrivatePerpsJournal(localStorage, next, passphrase, scope);
          if (!controller.signal.aborted) setJournal(next);
        }
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5_000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [journal]);

  useEffect(() => {
    if (!journal) return;
    const controller = new AbortController();
    void Promise.allSettled(journal.records.filter((record) => record.status !== "closed").map(async (record) => {
      const positionId = `0x${BigInt(record.positionCommitment).toString(16).padStart(64, "0")}`;
      const result = await apiRequest<{ residualRaw: string }>(
        webPublicConfig.apiUrl, `/v1/perps/private/residual/${positionId}`, { signal: controller.signal },
      );
      return [record.positionCommitment, result.residualRaw] as const;
    })).then((results) => {
      if (controller.signal.aborted) return;
      setResiduals((current) => Object.fromEntries([
        ...Object.entries(current),
        ...results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
      ]));
    });
    return () => controller.abort();
  }, [journal]);

  async function unlock() {
    if (!scope || !noteScope || !config?.perps || !config.shieldedV2?.proverRelease) return;
    setBusy(true);
    setError(null);
    try {
      const [perpsRelease, privateNoteRelease] = await Promise.all([
        loadPrivatePerpsRelease(config.environment, config.chainId, config.perps),
        fetchPrivateProverV2(noteScope, config.shieldedV2.proverRelease),
      ]);
      const loaded = await loadPrivatePerpsJournal(localStorage, passphrase, scope);
      const serializedNotes = localStorage.getItem(journalStorageKeyV2(noteScope));
      const notes = serializedNotes
        ? await decryptJournalV2(serializedNotes, passphrase, noteScope, async (note) =>
            (await calculatePrivateNoteV2(note, privateNoteRelease)).commitment === note.commitment)
        : null;
      if (loaded.records.length === 0) {
        await savePrivatePerpsJournal(
          localStorage, emptyPrivatePerpsJournal(), passphrase, scope,
        );
      }
      setJournal(loaded);
      setRelease(perpsRelease);
      setNoteRelease(privateNoteRelease);
      setNoteJournal(notes);
      setSelectedNote((current) => current || notes?.notes.find((note) =>
        note.resource.kind === "token"
          && note.resource.address.toLowerCase() === config.perps!.collateral.toLowerCase())?.commitment || "");
      setReleaseReady(true);
    } catch (reason) {
      setError(privatePerpsJournalError(reason));
    } finally {
      setBusy(false);
    }
  }

  const availableNotes = useMemo(() => noteJournal?.notes.filter((note) =>
    note.resource.kind === "token"
      && note.resource.address.toLowerCase() === config?.perps?.collateral.toLowerCase()) ?? [], [config, noteJournal]);

  async function saveNoteJournal(next: PrivateJournalV2) {
    if (!noteScope || !noteRelease || !navigator.locks) throw new Error("V2_BROWSER_LOCKS_REQUIRED");
    const saved = await persistJournalV2(next, passphrase, noteScope, {
      storage: localStorage,
      verify: async (note) => (await calculatePrivateNoteV2(note, noteRelease)).commitment === note.commitment,
      lock: async <T,>(name: string, work: () => Promise<T>) => {
        let result!: T;
        await navigator.locks.request(name, async () => { result = await work(); });
        return result;
      },
    });
    setNoteJournal(saved);
    return saved;
  }

  async function replaceNoteJournal(next: PrivateJournalV2) {
    if (!noteScope || !noteRelease || !navigator.locks) throw new Error("V2_BROWSER_LOCKS_REQUIRED");
    const saved = await replaceJournalV2(next, passphrase, noteScope, {
      storage: localStorage,
      verify: async (note) => (await calculatePrivateNoteV2(note, noteRelease)).commitment === note.commitment,
      lock: async <T,>(name: string, work: () => Promise<T>) => {
        let result!: T;
        await navigator.locks.request(name, async () => { result = await work(); });
        return result;
      },
    });
    setNoteJournal(saved);
    return saved;
  }

  async function prepareOpen() {
    if (!config?.perps || !noteScope || !noteRelease || !release || !journal || !noteJournal || !marketId || !currentPriceX18) return;
    setBusy(true); setError(null); setStage("Preparing private position");
    try {
      const inputNote = availableNotes.find((note) => note.commitment === selectedNote);
      if (!inputNote) throw new Error("Select a private USDG note.");
      const marginRaw = BigInt(Math.round(Number(margin) * 1e6));
      const feeRaw = BigInt(config.perps.relayer.feeRaw);
      const refundAmount = BigInt(inputNote.amount) - marginRaw - feeRaw;
      if (marginRaw <= 0n || refundAmount <= 0n) throw new Error("Selected note must cover margin, relay fee, and a non-zero refund.");
      const [path, calculatedInput] = await Promise.all([
        fetchPrivatePathV2(BigInt(inputNote.commitment)),
        calculatePrivateNoteV2(inputNote, noteRelease),
      ]);
      const refund = await createPrivateNoteV2(noteScope, inputNote.resource, refundAmount.toString(), "refund", noteRelease);
      const ownerSecret = randomField(31);
      const ownerNonce = randomField(16);
      const marketValue = BigInt(marketId);
      const mask = (1n << 128n) - 1n;
      const marketLow = marketValue & mask;
      const marketHigh = marketValue >> 128n;
      const position = await calculatePrivatePerpsPosition(release, config.environment, {
        chain_id: String(config.chainId), adapter: config.perps.shieldedAdapter,
        market_low: marketLow.toString(), market_high: marketHigh.toString(),
        is_long: side === "long" ? "1" : "0", margin: marginRaw.toString(),
        leverage_bps: String(leverage * 10_000), owner_secret: ownerSecret, owner_nonce: ownerNonce,
      });
      const price = BigInt(currentPriceX18);
      const acceptablePrice = side === "long" ? price * 10_100n / 10_000n : price * 9_900n / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const statement = {
        schemaVersion: 1 as const, action: "open" as const, chainId: BigInt(config.chainId),
        adapter: config.perps.shieldedAdapter as Address, custody: noteScope.settlement,
        collateral: config.perps.collateral as Address, treeVersion: BigInt(noteScope.treeVersion),
        merkleRoot: BigInt(path.root), marketId, isLong: side === "long", margin: marginRaw,
        leverageBps: BigInt(leverage * 10_000), acceptablePriceX18: acceptablePrice,
        deadline, nullifier: BigInt(calculatedInput.nullifier), positionCommitment: BigInt(position.commitment),
        refundCommitment: BigInt(refund.commitment), refundAmount,
        relayer: config.perps.relayer.address as Address, relayerFee: feeRaw,
      };
      const publicInputs = privatePerpOpenPublicInputsV1(statement).map(String);
      await saveNoteJournal({ ...noteJournal, notes: [...noteJournal.notes, refund] });
      const preparedJournal: PrivatePerpsJournal = { ...journal, records: [...journal.records, {
        positionCommitment: position.commitment, marketId, isLong: side === "long",
        marginRaw: marginRaw.toString(), leverageBps: leverage * 10_000,
        ownerSecret, ownerNonce, operation: "open", generatedNoteCommitment: refund.commitment,
        status: "prepared",
      }] };
      await savePrivatePerpsJournal(localStorage, preparedJournal, passphrase, scope!);
      setJournal(preparedJournal);
      const witness = {
        schema_version: "1", action: "1", chain_id: String(config.chainId),
        adapter: config.perps.shieldedAdapter, custody: noteScope.settlement,
        collateral: config.perps.collateral, tree_version: noteScope.treeVersion,
        merkle_root: BigInt(path.root).toString(), market_low: marketLow.toString(), market_high: marketHigh.toString(),
        is_long: side === "long" ? "1" : "0", margin: marginRaw.toString(), leverage_bps: String(leverage * 10_000),
        acceptable_price_x18: acceptablePrice.toString(), deadline: deadline.toString(),
        nullifier: calculatedInput.nullifier, position_commitment: position.commitment,
        refund_commitment: refund.commitment, relayer: config.perps.relayer.address,
        relayer_fee: feeRaw.toString(), note_amount: inputNote.amount, note_secret: inputNote.secret,
        note_nonce: inputNote.nonce, leaf_index: String(path.leafIndex),
        path_siblings: path.siblings.map((value) => BigInt(value).toString()),
        path_directions: path.directions.map(String), refund_amount: refundAmount.toString(),
        refund_secret: refund.secret, refund_nonce: refund.nonce,
        position_owner_secret: ownerSecret, position_owner_nonce: ownerNonce,
      };
      const proof = await provePrivatePerpsInBrowser({
        environment: config.environment, chainId: config.chainId, config: config.perps,
        release, kind: "open", witness, expectedPublicInputs: publicInputs,
      }, { onStage: (value) => setStage(value === "proving" ? "Generating proof" : "Verifying proof") });
      setStage("Submitting to private relayer");
      const relay = await apiRequest<RelayStatus>(webPublicConfig.apiUrl, "/v1/perps/private/relay", {
        method: "POST", body: JSON.stringify({ action: "open", proof: encodePrivatePerpsProof(proof), publicInputs }),
      });
      const submitted: PrivatePerpsJournal = { ...preparedJournal, records: preparedJournal.records.map((record) =>
        record.positionCommitment === position.commitment ? { ...record, relayRequestId: relay.requestId } : record) };
      await savePrivatePerpsJournal(localStorage, submitted, passphrase, scope!);
      setJournal(submitted); setStatuses((current) => ({ ...current, [relay.requestId]: relay }));
      setStage("Private position submitted");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PRIVATE_PERPS_OPEN_FAILED");
      setStage("");
    } finally { setBusy(false); }
  }

  async function prepareClose(record: PrivatePerpsJournal["records"][number]) {
    if (!config?.perps || !noteScope || !noteRelease || !release || !journal || !noteJournal) return;
    setBusy(true); setError(null); setStage("Quoting private close");
    try {
      const positionId = `0x${BigInt(record.positionCommitment).toString(16).padStart(64, "0")}` as `0x${string}`;
      const quote = await apiRequest<{
        executionPriceX18: string; payoutUsd: string;
      }>(webPublicConfig.apiUrl, `/v1/perps/quote/close/${positionId}`);
      const expectedPayout = BigInt(quote.payoutUsd);
      const feeRaw = BigInt(config.perps.relayer.feeRaw);
      if (expectedPayout <= feeRaw) throw new Error("Position payout does not cover the private relay fee.");
      const payout = await createPrivateNoteV2(
        noteScope,
        { kind: "token", address: config.perps.collateral as Address },
        (expectedPayout - feeRaw).toString(),
        "output",
        noteRelease,
      );
      const marketValue = BigInt(record.marketId);
      const mask = (1n << 128n) - 1n;
      const marketLow = marketValue & mask;
      const marketHigh = marketValue >> 128n;
      const position = await calculatePrivatePerpsPosition(release, config.environment, {
        chain_id: String(config.chainId), adapter: config.perps.shieldedAdapter,
        market_low: marketLow.toString(), market_high: marketHigh.toString(),
        is_long: record.isLong ? "1" : "0", margin: record.marginRaw,
        leverage_bps: String(record.leverageBps), owner_secret: record.ownerSecret,
        owner_nonce: record.ownerNonce,
      });
      if (position.commitment !== record.positionCommitment) throw new Error("PRIVATE_POSITION_CONTROL_MISMATCH");
      const executionPrice = BigInt(quote.executionPriceX18);
      const acceptablePrice = record.isLong
        ? executionPrice * 9_900n / 10_000n
        : executionPrice * 10_100n / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const statement = {
        schemaVersion: 1 as const, action: "close" as const, chainId: BigInt(config.chainId),
        adapter: config.perps.shieldedAdapter as Address, custody: noteScope.settlement,
        collateral: config.perps.collateral as Address, treeVersion: BigInt(noteScope.treeVersion),
        marketId: record.marketId, acceptablePriceX18: acceptablePrice, deadline,
        relayer: config.perps.relayer.address as Address, relayerFee: feeRaw,
        positionCommitment: BigInt(position.commitment), positionNullifier: BigInt(position.nullifier),
        expectedPayout, payoutCommitment: BigInt(payout.commitment),
      };
      const publicInputs = privatePerpClosePublicInputsV1(statement).map(String);
      await saveNoteJournal({ ...noteJournal, notes: [...noteJournal.notes, payout] });
      const closing: PrivatePerpsJournal = { ...journal, records: journal.records.map((item) =>
        item.positionCommitment === record.positionCommitment ? {
          ...item, operation: "close" as const, generatedNoteCommitment: payout.commitment,
          status: "closing" as const,
        } : item) };
      await savePrivatePerpsJournal(localStorage, closing, passphrase, scope!);
      setJournal(closing);
      const proof = await provePrivatePerpsInBrowser({
        environment: config.environment, chainId: config.chainId, config: config.perps,
        release, kind: "close", expectedPublicInputs: publicInputs,
        witness: {
          schema_version: "1", action: "2", chain_id: String(config.chainId),
          adapter: config.perps.shieldedAdapter, custody: noteScope.settlement,
          collateral: config.perps.collateral, tree_version: noteScope.treeVersion,
          market_low: marketLow.toString(), market_high: marketHigh.toString(),
          position_commitment: position.commitment, position_nullifier: position.nullifier,
          expected_payout: expectedPayout.toString(), acceptable_price_x18: acceptablePrice.toString(),
          deadline: deadline.toString(), payout_commitment: payout.commitment,
          relayer: config.perps.relayer.address, relayer_fee: feeRaw.toString(),
          is_long: record.isLong ? "1" : "0", margin: record.marginRaw,
          leverage_bps: String(record.leverageBps), position_owner_secret: record.ownerSecret,
          position_owner_nonce: record.ownerNonce, payout_secret: payout.secret, payout_nonce: payout.nonce,
        },
      }, { onStage: (value) => setStage(value === "proving" ? "Generating close proof" : "Verifying close proof") });
      setStage("Submitting private close");
      const relay = await apiRequest<RelayStatus>(webPublicConfig.apiUrl, "/v1/perps/private/relay", {
        method: "POST", body: JSON.stringify({ action: "close", proof: encodePrivatePerpsProof(proof), publicInputs }),
      });
      const submitted: PrivatePerpsJournal = { ...closing, records: closing.records.map((item) =>
        item.positionCommitment === record.positionCommitment ? { ...item, relayRequestId: relay.requestId } : item) };
      await savePrivatePerpsJournal(localStorage, submitted, passphrase, scope!);
      setJournal(submitted); setStatuses((current) => ({ ...current, [relay.requestId]: relay }));
      setStage("Private close submitted");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PRIVATE_PERPS_CLOSE_FAILED");
      setStage("");
    } finally { setBusy(false); }
  }

  async function prepareModify(record: PrivatePerpsJournal["records"][number]) {
    if (!config?.perps || !release || !journal || !marketId) return;
    const newLeverageBps = leverage * 10_000;
    if (newLeverageBps === record.leverageBps) {
      setError("Choose a different leverage before modifying the position.");
      return;
    }
    setBusy(true); setError(null); setStage("Quoting position update");
    try {
      const positionId = `0x${BigInt(record.positionCommitment).toString(16).padStart(64, "0")}` as `0x${string}`;
      const quote = await apiRequest<{
        expectedLockedMarginUsd: string; closePriceX18: string; openPriceX18: string;
      }>(webPublicConfig.apiUrl, `/v1/perps/quote/modify/${positionId}?leverageBps=${newLeverageBps}`);
      const marketValue = BigInt(record.marketId);
      const mask = (1n << 128n) - 1n;
      const marketLow = marketValue & mask;
      const marketHigh = marketValue >> 128n;
      const oldPosition = await calculatePrivatePerpsPosition(release, config.environment, {
        chain_id: String(config.chainId), adapter: config.perps.shieldedAdapter,
        market_low: marketLow.toString(), market_high: marketHigh.toString(),
        is_long: record.isLong ? "1" : "0", margin: record.marginRaw,
        leverage_bps: String(record.leverageBps), owner_secret: record.ownerSecret,
        owner_nonce: record.ownerNonce,
      });
      if (oldPosition.commitment !== record.positionCommitment) throw new Error("PRIVATE_POSITION_CONTROL_MISMATCH");
      const newOwnerSecret = randomField(31);
      const newOwnerNonce = randomField(16);
      const newPosition = await calculatePrivatePerpsPosition(release, config.environment, {
        chain_id: String(config.chainId), adapter: config.perps.shieldedAdapter,
        market_low: marketLow.toString(), market_high: marketHigh.toString(),
        is_long: record.isLong ? "1" : "0", margin: quote.expectedLockedMarginUsd,
        leverage_bps: String(newLeverageBps), owner_secret: newOwnerSecret, owner_nonce: newOwnerNonce,
      });
      const closePrice = BigInt(quote.closePriceX18);
      const openPrice = BigInt(quote.openPriceX18);
      const acceptableClosePrice = record.isLong ? closePrice * 9_900n / 10_000n : closePrice * 10_100n / 10_000n;
      const acceptableOpenPrice = record.isLong ? openPrice * 10_100n / 10_000n : openPrice * 9_900n / 10_000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const feeRaw = BigInt(config.perps.relayer.feeRaw);
      const statement = {
        schemaVersion: 1 as const, action: "modify" as const, chainId: BigInt(config.chainId),
        adapter: config.perps.shieldedAdapter as Address, marketId: record.marketId,
        isLong: record.isLong, oldMargin: BigInt(record.marginRaw),
        expectedNewMargin: BigInt(quote.expectedLockedMarginUsd),
        oldLeverageBps: BigInt(record.leverageBps), newLeverageBps: BigInt(newLeverageBps),
        oldPositionCommitment: BigInt(oldPosition.commitment), oldPositionNullifier: BigInt(oldPosition.nullifier),
        newPositionCommitment: BigInt(newPosition.commitment),
        acceptableClosePriceX18: acceptableClosePrice, acceptableOpenPriceX18: acceptableOpenPrice,
        deadline, relayer: config.perps.relayer.address as Address, relayerFee: feeRaw,
      };
      const publicInputs = privatePerpModifyPublicInputsV1(statement).map(String);
      const prepared: PrivatePerpsJournal = { ...journal, records: [
        ...journal.records.map((item) => item.positionCommitment === record.positionCommitment
          ? { ...item, status: "modifying" as const } : item),
        {
          positionCommitment: newPosition.commitment, marketId: record.marketId,
          isLong: record.isLong, marginRaw: quote.expectedLockedMarginUsd,
          leverageBps: newLeverageBps, ownerSecret: newOwnerSecret, ownerNonce: newOwnerNonce,
          operation: "modify" as const, replacesCommitment: record.positionCommitment,
          status: "prepared" as const,
        },
      ] };
      await savePrivatePerpsJournal(localStorage, prepared, passphrase, scope!);
      setJournal(prepared);
      const proof = await provePrivatePerpsInBrowser({
        environment: config.environment, chainId: config.chainId, config: config.perps,
        release, kind: "modify", expectedPublicInputs: publicInputs,
        witness: {
          schema_version: "1", action: "3", chain_id: String(config.chainId),
          adapter: config.perps.shieldedAdapter, market_low: marketLow.toString(), market_high: marketHigh.toString(),
          is_long: record.isLong ? "1" : "0", old_margin: record.marginRaw,
          expected_new_margin: quote.expectedLockedMarginUsd, old_leverage_bps: String(record.leverageBps),
          new_leverage_bps: String(newLeverageBps), old_position_commitment: oldPosition.commitment,
          old_position_nullifier: oldPosition.nullifier, new_position_commitment: newPosition.commitment,
          acceptable_close_price_x18: acceptableClosePrice.toString(),
          acceptable_open_price_x18: acceptableOpenPrice.toString(), deadline: deadline.toString(),
          relayer: config.perps.relayer.address, relayer_fee: feeRaw.toString(),
          old_owner_secret: record.ownerSecret, old_owner_nonce: record.ownerNonce,
          new_owner_secret: newOwnerSecret, new_owner_nonce: newOwnerNonce,
        },
      }, { onStage: (value) => setStage(value === "proving" ? "Generating update proof" : "Verifying update proof") });
      setStage("Submitting position update");
      const relay = await apiRequest<RelayStatus>(webPublicConfig.apiUrl, "/v1/perps/private/relay", {
        method: "POST", body: JSON.stringify({ action: "modify", proof: encodePrivatePerpsProof(proof), publicInputs }),
      });
      const submitted: PrivatePerpsJournal = { ...prepared, records: prepared.records.map((item) =>
        item.positionCommitment === newPosition.commitment ? { ...item, relayRequestId: relay.requestId } : item) };
      await savePrivatePerpsJournal(localStorage, submitted, passphrase, scope!);
      setJournal(submitted); setStatuses((current) => ({ ...current, [relay.requestId]: relay }));
      setStage("Private position update submitted");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PRIVATE_PERPS_MODIFY_FAILED");
      setStage("");
    } finally { setBusy(false); }
  }

  async function claimResidual(record: PrivatePerpsJournal["records"][number]) {
    if (!config?.perps || !noteScope || !noteRelease || !release || !journal || !noteJournal) return;
    setBusy(true); setError(null); setStage("Preparing residual claim");
    try {
      const positionId = `0x${BigInt(record.positionCommitment).toString(16).padStart(64, "0")}` as `0x${string}`;
      const { residualRaw } = await apiRequest<{ residualRaw: string }>(
        webPublicConfig.apiUrl, `/v1/perps/private/residual/${positionId}`,
      );
      const residual = BigInt(residualRaw);
      const feeRaw = BigInt(config.perps.relayer.feeRaw);
      if (residual <= feeRaw) throw new Error("No claimable residual is available after the relay fee.");
      const payout = await createPrivateNoteV2(
        noteScope,
        { kind: "token", address: config.perps.collateral as Address },
        (residual - feeRaw).toString(), "output", noteRelease,
      );
      const marketValue = BigInt(record.marketId);
      const mask = (1n << 128n) - 1n;
      const marketLow = marketValue & mask;
      const marketHigh = marketValue >> 128n;
      const position = await calculatePrivatePerpsPosition(release, config.environment, {
        chain_id: String(config.chainId), adapter: config.perps.shieldedAdapter,
        market_low: marketLow.toString(), market_high: marketHigh.toString(),
        is_long: record.isLong ? "1" : "0", margin: record.marginRaw,
        leverage_bps: String(record.leverageBps), owner_secret: record.ownerSecret,
        owner_nonce: record.ownerNonce,
      });
      if (position.commitment !== record.positionCommitment) throw new Error("PRIVATE_POSITION_CONTROL_MISMATCH");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      const statement = {
        schemaVersion: 1 as const, action: "claim-liquidated" as const,
        chainId: BigInt(config.chainId), adapter: config.perps.shieldedAdapter as Address,
        custody: noteScope.settlement, collateral: config.perps.collateral as Address,
        treeVersion: BigInt(noteScope.treeVersion), marketId: record.marketId,
        positionCommitment: BigInt(position.commitment), positionNullifier: BigInt(position.nullifier),
        expectedResidual: residual, deadline, payoutCommitment: BigInt(payout.commitment),
        relayer: config.perps.relayer.address as Address, relayerFee: feeRaw,
      };
      const publicInputs = privatePerpClaimLiquidatedPublicInputsV1(statement).map(String);
      await saveNoteJournal({ ...noteJournal, notes: [...noteJournal.notes, payout] });
      const claiming: PrivatePerpsJournal = { ...journal, records: journal.records.map((item) =>
        item.positionCommitment === record.positionCommitment ? {
          ...item, operation: "claim-liquidated" as const,
          generatedNoteCommitment: payout.commitment, status: "liquidated" as const,
        } : item) };
      await savePrivatePerpsJournal(localStorage, claiming, passphrase, scope!);
      setJournal(claiming);
      const proof = await provePrivatePerpsInBrowser({
        environment: config.environment, chainId: config.chainId, config: config.perps,
        release, kind: "claim-liquidated", expectedPublicInputs: publicInputs,
        witness: {
          schema_version: "1", action: "4", chain_id: String(config.chainId),
          adapter: config.perps.shieldedAdapter, custody: noteScope.settlement,
          collateral: config.perps.collateral, tree_version: noteScope.treeVersion,
          market_low: marketLow.toString(), market_high: marketHigh.toString(),
          position_commitment: position.commitment, position_nullifier: position.nullifier,
          expected_residual: residual.toString(), deadline: deadline.toString(),
          payout_commitment: payout.commitment, relayer: config.perps.relayer.address,
          relayer_fee: feeRaw.toString(), is_long: record.isLong ? "1" : "0",
          margin: record.marginRaw, leverage_bps: String(record.leverageBps),
          position_owner_secret: record.ownerSecret, position_owner_nonce: record.ownerNonce,
          payout_secret: payout.secret, payout_nonce: payout.nonce,
        },
      }, { onStage: (value) => setStage(value === "proving" ? "Generating claim proof" : "Verifying claim proof") });
      setStage("Submitting residual claim");
      const relay = await apiRequest<RelayStatus>(webPublicConfig.apiUrl, "/v1/perps/private/relay", {
        method: "POST", body: JSON.stringify({ action: "claim-liquidated", proof: encodePrivatePerpsProof(proof), publicInputs }),
      });
      const submitted: PrivatePerpsJournal = { ...claiming, records: claiming.records.map((item) =>
        item.positionCommitment === record.positionCommitment ? { ...item, relayRequestId: relay.requestId } : item) };
      await savePrivatePerpsJournal(localStorage, submitted, passphrase, scope!);
      setJournal(submitted); setStatuses((current) => ({ ...current, [relay.requestId]: relay }));
      setStage("Residual claim submitted");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PRIVATE_PERPS_CLAIM_FAILED");
      setStage("");
    } finally { setBusy(false); }
  }

  async function archiveDraft(record: PrivatePerpsJournal["records"][number]) {
    if (!journal || !noteJournal || !scope) return;
    setBusy(true); setError(null); setStage("Archiving local draft");
    try {
      const restored = journal.records.flatMap((item) => {
        if (item.positionCommitment === record.positionCommitment) {
          if (record.replacesCommitment || record.operation === "open") return [];
          const {
            relayRequestId: _relayRequestId,
            transactionHash: _transactionHash,
            generatedNoteCommitment: _generatedNoteCommitment,
            operation: _operation,
            ...base
          } = item;
          return [{ ...base, status: "open" as const }];
        }
        if (record.replacesCommitment && item.positionCommitment === record.replacesCommitment) {
          return [{ ...item, status: "open" as const }];
        }
        return [item];
      });
      const nextPerps: PrivatePerpsJournal = { ...journal, records: restored };
      await savePrivatePerpsJournal(localStorage, nextPerps, passphrase, scope);
      setJournal(nextPerps);
      if (record.generatedNoteCommitment) {
        const commitment = record.generatedNoteCommitment;
        const referenced = noteJournal.intents.some((intent) =>
          [...intent.inputs, ...intent.outputs, ...intent.refunds].includes(commitment))
          || noteJournal.transactions.some((transaction) => transaction.commitment === commitment);
        if (!referenced) {
          await replaceNoteJournal({
            ...noteJournal,
            notes: noteJournal.notes.filter((note) => note.commitment !== commitment),
          });
        }
      }
      setStage("Local draft archived. The original spendable control is available again.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PRIVATE_PERPS_ARCHIVE_FAILED");
      setStage("");
    } finally { setBusy(false); }
  }

  function exportJournal() {
    if (!scope) return;
    const encrypted = localStorage.getItem(privatePerpsJournalKey(scope));
    if (!encrypted) return;
    const url = URL.createObjectURL(new Blob([encrypted], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zkblast-private-perps-${scope.chainId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function restoreJournal(file: File) {
    if (!scope) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await decryptPrivatePerpsJournal(await file.text(), passphrase, scope);
      await savePrivatePerpsJournal(localStorage, restored, passphrase, scope);
      setJournal(restored);
    } catch (reason) {
      setError(privatePerpsJournalError(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!scope || !config?.perps) {
    return (
      <div className="border border-line bg-black/20 p-4 text-xs leading-relaxed text-muted">
        Shielded Perps will appear automatically when this network publishes its verified deployment and prover manifest.
      </div>
    );
  }
  const perpsConfig = config.perps;

  if (!journal) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 border border-line bg-black/20 p-3">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-lime" aria-hidden />
          <div>
            <p className="font-mono text-xs">Unlock private positions</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Position controls stay encrypted in this browser and are bound to {config.chainName}.
            </p>
          </div>
        </div>
        <label className="block text-xs text-muted">
          Journal passphrase
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            autoComplete="current-password"
            className="mt-2 h-11 w-full border border-line bg-black/20 px-3 font-mono text-sm outline-none focus:border-lime/70"
          />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <button
          type="button"
          disabled={busy || passphrase.length < 12}
          onClick={() => void unlock()}
          className="h-11 w-full bg-fg font-mono text-xs font-bold uppercase tracking-[0.12em] text-bg disabled:opacity-40"
        >
          {busy ? "Validating local journal" : "Unlock journal"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 border border-line bg-black/20 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-lime" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-mono text-xs">{marketLabel}</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted">
              {releaseReady ? "Local prover verified" : "Loading prover"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setJournal(null)}
          className="font-mono text-[10px] uppercase text-muted hover:text-fg"
        >
          Lock
        </button>
      </div>
      <section className="space-y-3" aria-labelledby="private-perps-open">
        <h4 id="private-perps-open" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          Open private position
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {(["long", "short"] as const).map((value) => {
            const Icon = value === "long" ? ArrowUpRight : ArrowDownRight;
            return (
              <button key={value} type="button" aria-pressed={side === value} onClick={() => onSideChange(value)}
                className={`flex h-10 items-center justify-center gap-2 border font-mono text-[10px] uppercase ${side === value ? "border-lime bg-lime/15 text-lime" : "border-line text-muted hover:bg-raised"}`}>
                <Icon className="size-3" aria-hidden /> {value}
              </button>
            );
          })}
        </div>
        <label className="block text-xs text-muted">
          Private USDG note
          <select value={selectedNote} onChange={(event) => setSelectedNote(event.target.value)}
            className="mt-2 h-11 w-full border border-line bg-bg px-3 font-mono text-xs outline-none focus:border-line-strong">
            <option value="">Select a note</option>
            {availableNotes.map((note) => (
              <option key={note.commitment} value={note.commitment}>
                {(Number(note.amount) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDG · {note.commitment.slice(0, 8)}…
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          Margin
          <div className="mt-2 flex items-center border border-line bg-black/20 focus-within:border-line-strong">
            <input value={margin} inputMode="decimal" onChange={(event) => onMarginChange(event.target.value)}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-base outline-none" />
            <span className="px-3 font-mono text-xs text-muted">USDG</span>
          </div>
        </label>
        <label className="block text-xs text-muted">
          Leverage <span className="float-right font-mono text-fg">{leverage}x</span>
          <input type="range" min={1} max={maximumLeverage} step={1} value={Math.min(leverage, maximumLeverage)}
            onChange={(event) => onLeverageChange(Number(event.target.value))} className="mt-3 w-full accent-lime" />
        </label>
        <button type="button" disabled={busy || !selectedNote || !marketId || !currentPriceX18}
          onClick={() => void prepareOpen()}
          className="h-11 w-full bg-fg font-mono text-xs font-bold uppercase tracking-[0.12em] text-bg disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? stage || "Preparing" : "Open private position"}
        </button>
        {availableNotes.length === 0 && (
          <p className="text-xs leading-relaxed text-muted">Deposit USDG privately to use it as position margin.</p>
        )}
        {stage && !busy && <p className="text-xs text-lime" role="status">{stage}</p>}
        <p className="text-[11px] leading-relaxed text-muted">
          Confirmed refund, close payout, and liquidation payout notes stay in the same encrypted Shielded journal. Open Shielded withdrawal to withdraw them or select them for another private action.
        </p>
      </section>
      <section className="space-y-2" aria-labelledby="private-perps-positions">
        <div className="flex items-center justify-between">
          <h4 id="private-perps-positions" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Private positions
          </h4>
          <RefreshCw className="size-3 text-muted" aria-hidden />
        </div>
        {journal.records.length === 0 ? (
          <p className="border border-line p-3 text-xs leading-relaxed text-muted">
            No private position controls are stored in this journal.
          </p>
        ) : journal.records.map((record) => {
          const relay = record.relayRequestId ? statuses[record.relayRequestId] : undefined;
          return (
            <article key={record.positionCommitment} className="min-w-0 overflow-hidden border border-line bg-black/20 p-3 font-mono text-[11px]">
              <div className="flex min-w-0 flex-wrap justify-between gap-2">
                <span className="min-w-0">{record.isLong ? "Long" : "Short"} · {record.leverageBps / 10_000}x</span>
                <span className="shrink-0 uppercase text-muted">{relay?.status ?? record.status}</span>
              </div>
              <p className="mt-1 text-muted">Margin {(Number(record.marginRaw) / 1e6).toFixed(4)} USDG</p>
              {relay?.transactionHash && (
                <a
                  href={`${config.explorerUrl}/tx/${relay.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-lime hover:underline"
                >
                  {relay.transactionHash}
                </a>
              )}
              {relay?.errorCode && <p className="mt-2 text-danger">{relay.errorCode}</p>}
              {((relay && ["failed", "expired"].includes(relay.status))
                || (!record.relayRequestId && ["prepared", "closing", "modifying", "liquidated"].includes(record.status))) && (
                <button type="button" disabled={busy} onClick={() => void archiveDraft(record)}
                  className="mt-3 h-9 w-full border border-line text-[10px] font-bold uppercase tracking-[0.1em] text-muted hover:bg-raised hover:text-fg disabled:opacity-40">
                  Archive failed draft
                </button>
              )}
              {BigInt(residuals[record.positionCommitment] ?? "0") > BigInt(perpsConfig.relayer.feeRaw) && record.status !== "closed" && (
                <button type="button" disabled={busy} onClick={() => void claimResidual(record)}
                  className="mt-3 h-9 w-full border border-lime/50 text-[10px] font-bold uppercase tracking-[0.1em] text-lime hover:bg-lime/10 disabled:opacity-40">
                  Claim {(Number(residuals[record.positionCommitment]) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDG residual
                </button>
              )}
              {(record.status === "open" || (record.status === "prepared" && relay?.status === "confirmed")) && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button type="button" disabled={busy || leverage * 10_000 === record.leverageBps} onClick={() => void prepareModify(record)}
                    className="h-9 border border-line text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-raised disabled:opacity-40">
                    Update leverage
                  </button>
                  <button type="button" disabled={busy} onClick={() => void prepareClose(record)}
                    className="h-9 border border-line text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-raised disabled:opacity-40">
                    Close privately
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </section>
      <div className="grid grid-cols-2 gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={exportJournal}
          className="flex h-10 items-center justify-center gap-2 border border-line font-mono text-[10px] uppercase hover:bg-raised"
        >
          <Download className="size-3" aria-hidden /> Export
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => restoreInput.current?.click()}
          className="flex h-10 items-center justify-center gap-2 border border-line font-mono text-[10px] uppercase hover:bg-raised disabled:opacity-40"
        >
          <Upload className="size-3" aria-hidden /> Restore
        </button>
        <input
          ref={restoreInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void restoreJournal(file);
            event.target.value = "";
          }}
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
