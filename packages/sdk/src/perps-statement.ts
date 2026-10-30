import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { assertCanonicalFieldV2 } from "./shielded-v2-note.js";

export const PERP_DOMAINS_V1 = {
  position: 3_001_001n,
  positionNullifier: 3_001_002n,
  open: 3_001_003n,
  close: 3_001_004n,
} as const;

type Common = Readonly<{
  schemaVersion: 1;
  chainId: bigint;
  adapter: Address;
  collateral: Address;
  treeVersion: bigint;
  marketId: Hex;
  acceptablePriceX18: bigint;
  deadline: bigint;
  relayer: Address;
  relayerFee: bigint;
}>;

export type PrivatePerpOpenStatementV1 = Common & Readonly<{
  action: "open";
  custody: Address;
  merkleRoot: bigint;
  isLong: boolean;
  margin: bigint;
  leverageBps: bigint;
  nullifier: bigint;
  positionCommitment: bigint;
  refundCommitment: bigint;
  refundAmount: bigint;
}>;

export type PrivatePerpCloseStatementV1 = Common & Readonly<{
  action: "close";
  custody: Address;
  positionCommitment: bigint;
  positionNullifier: bigint;
  expectedPayout: bigint;
  payoutCommitment: bigint;
}>;

export type PrivatePerpModifyStatementV1 = Omit<Common, "collateral" | "treeVersion" | "acceptablePriceX18"> & Readonly<{
  action: "modify";
  isLong: boolean;
  oldMargin: bigint;
  expectedNewMargin: bigint;
  oldLeverageBps: bigint;
  newLeverageBps: bigint;
  acceptableClosePriceX18: bigint;
  acceptableOpenPriceX18: bigint;
  oldPositionCommitment: bigint;
  oldPositionNullifier: bigint;
  newPositionCommitment: bigint;
}>;

export type PrivatePerpClaimLiquidatedStatementV1 = Omit<Common, "acceptablePriceX18"> & Readonly<{
  action: "claim-liquidated";
  custody: Address;
  positionCommitment: bigint;
  positionNullifier: bigint;
  expectedResidual: bigint;
  payoutCommitment: bigint;
}>;

const FIELD_BITS = 254n;

function bounded(value: bigint, bits: bigint, label: string, nonzero = false) {
  if (value < 0n || value >= 1n << bits || (nonzero && value === 0n))
    throw new Error(`Invalid private Perps ${label}`);
}

function address(value: Address, label: string): bigint {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value) || BigInt(value) === 0n)
    throw new Error(`Invalid private Perps ${label}`);
  return BigInt(value);
}

function marketLimbs(marketId: Hex): readonly [bigint, bigint] {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(marketId))
    throw new Error("Invalid private Perps market");
  const value = BigInt(marketId);
  const mask = (1n << 128n) - 1n;
  return [value & mask, value >> 128n];
}

function common(statement: Common) {
  if (statement.schemaVersion !== 1) throw new Error("Invalid private Perps schema");
  bounded(statement.chainId, 64n, "chain", true);
  bounded(statement.treeVersion, 64n, "tree version", true);
  bounded(statement.acceptablePriceX18, 128n, "acceptable price", true);
  bounded(statement.deadline, 64n, "deadline", true);
  bounded(statement.relayerFee, 128n, "relayer fee");
  return {
    adapter: address(statement.adapter, "adapter"),
    collateral: address(statement.collateral, "collateral"),
    relayer: address(statement.relayer, "relayer"),
    market: marketLimbs(statement.marketId),
  };
}

/** Exact `perps/open.circom` public-input order. */
export function privatePerpOpenPublicInputsV1(statement: PrivatePerpOpenStatementV1) {
  if (statement.action !== "open") throw new Error("Invalid private Perps open action");
  const context = common(statement);
  bounded(statement.margin, 128n, "margin", true);
  bounded(statement.leverageBps, 32n, "leverage", true);
  bounded(statement.refundAmount, 128n, "refund amount", true);
  if (statement.leverageBps < 10_000n || statement.leverageBps > 100_000n)
    throw new Error("Private Perps leverage outside protocol bounds");
  for (const [label, value] of [
    ["root", statement.merkleRoot],
    ["nullifier", statement.nullifier],
    ["position commitment", statement.positionCommitment],
    ["refund commitment", statement.refundCommitment],
  ] as const) {
    bounded(value, FIELD_BITS, label, true);
    assertCanonicalFieldV2(value);
  }
  return [
    1n, 1n, statement.chainId, context.adapter, address(statement.custody, "custody"), context.collateral,
    statement.treeVersion, statement.merkleRoot, ...context.market,
    statement.isLong ? 1n : 0n, statement.margin, statement.leverageBps,
    statement.acceptablePriceX18, statement.deadline, statement.nullifier,
    statement.positionCommitment, statement.refundCommitment, statement.refundAmount, context.relayer,
    statement.relayerFee,
  ] as const;
}

/** Exact `perps/close.circom` public-input order. */
export function privatePerpClosePublicInputsV1(statement: PrivatePerpCloseStatementV1) {
  if (statement.action !== "close") throw new Error("Invalid private Perps close action");
  const context = common(statement);
  bounded(statement.expectedPayout, 128n, "expected payout", true);
  if (statement.relayerFee >= statement.expectedPayout)
    throw new Error("Private Perps relayer fee consumes payout");
  for (const [label, value] of [
    ["position commitment", statement.positionCommitment],
    ["position nullifier", statement.positionNullifier],
    ["payout commitment", statement.payoutCommitment],
  ] as const) {
    bounded(value, FIELD_BITS, label, true);
    assertCanonicalFieldV2(value);
  }
  return [
    1n, 2n, statement.chainId, context.adapter, address(statement.custody, "custody"), context.collateral,
    statement.treeVersion, ...context.market, statement.positionCommitment,
    statement.positionNullifier, statement.expectedPayout,
    statement.acceptablePriceX18, statement.deadline,
    statement.payoutCommitment, context.relayer, statement.relayerFee,
  ] as const;
}

export function privatePerpOpenStatementHashV1(statement: PrivatePerpOpenStatementV1): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256[21]" }], [privatePerpOpenPublicInputsV1(statement)]));
}

export function privatePerpCloseStatementHashV1(statement: PrivatePerpCloseStatementV1): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256[17]" }], [privatePerpClosePublicInputsV1(statement)]));
}

export function privatePerpModifyPublicInputsV1(statement: PrivatePerpModifyStatementV1) {
  if (statement.action !== "modify" || statement.schemaVersion !== 1)
    throw new Error("Invalid private Perps modify action");
  bounded(statement.chainId, 64n, "chain", true);
  bounded(statement.oldMargin, 128n, "old margin", true);
  bounded(statement.expectedNewMargin, 128n, "expected new margin", true);
  bounded(statement.acceptableClosePriceX18, 128n, "acceptable close price", true);
  bounded(statement.acceptableOpenPriceX18, 128n, "acceptable open price", true);
  bounded(statement.deadline, 64n, "deadline", true);
  bounded(statement.relayerFee, 128n, "relayer fee");
  for (const leverage of [statement.oldLeverageBps, statement.newLeverageBps]) {
    if (leverage < 10_000n || leverage > 100_000n)
      throw new Error("Private Perps leverage outside protocol bounds");
  }
  for (const value of [statement.oldPositionCommitment, statement.oldPositionNullifier, statement.newPositionCommitment]) {
    assertCanonicalFieldV2(value);
    bounded(value, FIELD_BITS, "position field", true);
  }
  if (statement.oldPositionCommitment === statement.newPositionCommitment)
    throw new Error("Private Perps modify must rotate position commitment");
  const [marketLow, marketHigh] = marketLimbs(statement.marketId);
  return [
    1n, 3n, statement.chainId, address(statement.adapter, "adapter"), marketLow,
    marketHigh, statement.isLong ? 1n : 0n, statement.oldMargin, statement.expectedNewMargin,
    statement.oldLeverageBps, statement.newLeverageBps,
    statement.oldPositionCommitment, statement.oldPositionNullifier,
    statement.newPositionCommitment, statement.acceptableClosePriceX18,
    statement.acceptableOpenPriceX18,
    statement.deadline, address(statement.relayer, "relayer"), statement.relayerFee,
  ] as const;
}

export function privatePerpClaimLiquidatedPublicInputsV1(statement: PrivatePerpClaimLiquidatedStatementV1) {
  if (statement.action !== "claim-liquidated" || statement.schemaVersion !== 1)
    throw new Error("Invalid private Perps claim action");
  bounded(statement.chainId, 64n, "chain", true);
  bounded(statement.treeVersion, 64n, "tree version", true);
  bounded(statement.expectedResidual, 128n, "expected residual", true);
  bounded(statement.deadline, 64n, "deadline", true);
  bounded(statement.relayerFee, 128n, "relayer fee");
  if (statement.relayerFee >= statement.expectedResidual)
    throw new Error("Private Perps relayer fee consumes residual");
  for (const value of [statement.positionCommitment, statement.positionNullifier, statement.payoutCommitment]) {
    assertCanonicalFieldV2(value);
    bounded(value, FIELD_BITS, "claim field", true);
  }
  const [marketLow, marketHigh] = marketLimbs(statement.marketId);
  return [
    1n, 4n, statement.chainId, address(statement.adapter, "adapter"),
    address(statement.custody, "custody"), address(statement.collateral, "collateral"), statement.treeVersion,
    marketLow, marketHigh, statement.positionCommitment,
    statement.positionNullifier, statement.expectedResidual, statement.deadline,
    statement.payoutCommitment, address(statement.relayer, "relayer"),
    statement.relayerFee,
  ] as const;
}

export function privatePerpModifyStatementHashV1(statement: PrivatePerpModifyStatementV1): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256[19]" }], [privatePerpModifyPublicInputsV1(statement)]));
}

export function privatePerpClaimLiquidatedStatementHashV1(statement: PrivatePerpClaimLiquidatedStatementV1): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256[16]" }], [privatePerpClaimLiquidatedPublicInputsV1(statement)]));
}
