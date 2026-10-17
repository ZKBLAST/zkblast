// Dummy feed for the landing "system overview" terminal. Every value is simulated.
import { pools, seeded } from "./pools";
import { vault } from "./shielded";

export type Lane = "public" | "shielded";

export type Intent = {
  id: number;
  lane: Lane;
  kind: "SWAP" | "ADD" | "REMOVE" | "CLAIM" | "DEPOSIT" | "WITHDRAW";
  pair: string;
  amount: string;
  route?: string;
};

const hex = (r: () => number, n = 4) => Array.from({ length: n }, () => ((r() * 256) | 0).toString(16).padStart(2, "0")).join("");
export const shortHash = (r: () => number) => `0x${hex(r, 2)}…${hex(r, 2)}`;

// Builds the k-th simulated intent. Deterministic so SSR and client agree on first paint.
export function intentAt(k: number): Intent {
  const r = seeded((9001 + Math.imul(k, 2654435761)) >>> 0);
  r(); r();
  const shielded = r() < 0.28;
  if (shielded) {
    const asset = r() < 0.5 ? "WETH" : "USDC";
    const denoms = vault.denominations[asset];
    const amt = denoms[(r() * denoms.length) | 0];
    return { id: k, lane: "shielded", kind: r() < 0.55 ? "DEPOSIT" : "WITHDRAW", pair: asset, amount: `${amt.toLocaleString("en-US")} ${asset}` };
  }
  const p = pools[(r() * pools.length) | 0];
  const roll = r();
  const kind = roll < 0.66 ? "SWAP" : roll < 0.8 ? "ADD" : roll < 0.9 ? "CLAIM" : "REMOVE";
  const size = p.price > 100 ? (r() * 4 + 0.05).toFixed(2) : (r() * 9000 + 40).toFixed(0);
  return {
    id: k,
    lane: "public",
    kind,
    pair: `${p.base}/${p.quote}`,
    amount: `${size} ${p.base}`,
    route: `${p.type} ${p.binStep ? p.binStep + "bps" : (p.feeBps / 100).toFixed(2) + "%"}`,
  };
}

export const terminalMeta = {
  treeDepth: vault.treeDepth,
  rootHistory: vault.rootHistory,
  circuit: vault.circuit.id,
  startLeaf: vault.totalCommitments,
  startNullifiers: vault.spentNullifiers,
  startBlock: 4_812_330,
};
