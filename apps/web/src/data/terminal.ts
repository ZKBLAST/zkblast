export type Lane = "public" | "shielded" | "system";

export type Intent = Readonly<{
  id: string;
  lane: Lane;
  kind: "SWAP" | "ROUTE" | "SYNC" | "PROOF" | "NULLIFIER";
  pair: string;
  amount: string;
  route: string;
}>;

export const pipelineBaseline: readonly Intent[] = [
  {
    id: "router-registry",
    lane: "public",
    kind: "ROUTE",
    pair: "Pool registry",
    amount: "Route discovery active",
    route: "DAMM / DLMM",
  },
  {
    id: "indexer-head",
    lane: "system",
    kind: "SYNC",
    pair: "Chain indexer",
    amount: "Finality tracking active",
    route: "Robinhood Chain",
  },
  {
    id: "proof-verifier",
    lane: "shielded",
    kind: "PROOF",
    pair: "Proof verifier",
    amount: "Verification path ready",
    route: "Groth16",
  },
  {
    id: "nullifier-registry",
    lane: "shielded",
    kind: "NULLIFIER",
    pair: "Nullifier registry",
    amount: "Double-spend guard active",
    route: "Vault",
  },
];

export const nullifierBaseline = [
  "Registry connected",
  "Root tracking active",
  "Spend guard active",
  "Proof context bound",
] as const;
