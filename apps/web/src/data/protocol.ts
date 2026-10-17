export type PhaseStatus = "Live" | "Rolling out" | "Next" | "Later";

export const roadmap: { phase: string; title: string; status: PhaseStatus; points: string[] }[] = [
  { phase: "Phase 1", title: "Public liquidity", status: "Live", points: ["DLMM bins and DAMM pools", "Swap quotes, slippage, routing", "Positions and fee claims"] },
  { phase: "Phase 2", title: "Proof foundation", status: "Live", points: ["Commitment tree, nullifier registry", "Versioned proof verifier", "Reproducible test vectors"] },
  { phase: "Phase 3", title: "Shielded LP vault", status: "Rolling out", points: ["Allowlisted vault pairs", "Encrypted note backup", "Share-based LP accounting"] },
  { phase: "Phase 4", title: "Shielded swaps", status: "Next", points: ["Private routing through the vault", "MEV and anonymity-set analysis", "Independent security review"] },
  { phase: "Phase 5", title: "Ecosystem", status: "Later", points: ["Integrator SDK", "Analytics API", "Partner pool launches"] },
];

export type ModuleLayer = "Core" | "Proof" | "Periphery";

export const modules: { name: string; role: string; layer: ModuleLayer }[] = [
  { name: "ZKBlastVault", role: "Custody, deposits, withdrawals, pause controls, asset allowlist", layer: "Core" },
  { name: "CommitmentTree", role: "Incremental Merkle tree with bounded root history", layer: "Core" },
  { name: "NullifierRegistry", role: "Tracks spent notes so none redeems twice", layer: "Core" },
  { name: "VerifierRegistry", role: "Approved verification keys mapped to circuit versions", layer: "Proof" },
  { name: "ZKVerifierAdapter", role: "Proof verification with an explicit public-input schema", layer: "Proof" },
  { name: "ShieldedLPManager", role: "Vault-owned AMM positions and share accounting", layer: "Core" },
  { name: "ZKBlastRouter", role: "Best-price routing across DLMM and DAMM pools", layer: "Periphery" },
  { name: "FeeAccounting", role: "Deterministic fee accounting and claims", layer: "Periphery" },
];
