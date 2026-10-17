// Shielded vault MVP: testnet only, allowlisted pair, simulated state.
export type NoteStatus = "unspent" | "spent" | "pending";

export type ShieldedNote = {
  id: string; // local label only; the commitment is what goes onchain
  asset: "WETH" | "USDC";
  amount: number;
  commitment: string;
  leafIndex: number;
  createdAt: string; // ISO
  status: NoteStatus;
  backedUp: boolean;
};

export const vault = {
  name: "ZKBlastVault (MVP)",
  environment: "Testnet",
  allowlist: ["WETH", "USDC"] as const,
  treeDepth: 20,
  rootHistory: 30,
  circuit: { id: "withdraw_v0", backend: "Pending benchmark (Noir or Circom)", version: "0.0.0-sim" },
  verifierKeyHash: null as string | null, // published only after a real deployment
  totalCommitments: 1_284,
  spentNullifiers: 417,
  vaultAssets: { WETH: 312.44, USDC: 802_115.2 },
  vaultLiabilities: { WETH: 312.44, USDC: 802_115.2 },
  anonymitySet: { WETH: 538, USDC: 329 },
  denominations: {
    WETH: [0.1, 1, 10],
    USDC: [100, 1_000, 10_000],
  },
};

export const sync = {
  localRoot: "0x1f9c…a03e",
  indexerRoot: "0x1f9c…a03e",
  chainRoot: "0x1f9c…a03e",
  lastSyncedLeaf: 1_283,
  lagBlocks: 0,
  rootAccepted: true,
};

export const notes: ShieldedNote[] = [
  { id: "note-01", asset: "USDC", amount: 1_000, commitment: "0x0b74…91de", leafIndex: 1_201, createdAt: "2026-10-09T14:22:00Z", status: "unspent", backedUp: true },
  { id: "note-02", asset: "WETH", amount: 1, commitment: "0x2e10…7c4b", leafIndex: 1_240, createdAt: "2026-10-12T08:03:00Z", status: "unspent", backedUp: false },
  { id: "note-03", asset: "USDC", amount: 100, commitment: "0x19ad…0f33", leafIndex: 1_102, createdAt: "2026-10-02T19:47:00Z", status: "spent", backedUp: true },
];

// Proof pipeline stages shown during deposit and withdraw (durations are simulated).
export const depositStages = [
  { key: "approve", label: "Approve exact amount", detail: "Allowance set to the deposit amount only", ms: 1100 },
  { key: "note", label: "Generate note secret", detail: "Secret and nonce created in this browser", ms: 700 },
  { key: "commit", label: "Compute commitment", detail: "Bound to chain, vault, asset, amount", ms: 900 },
  { key: "deposit", label: "Submit deposit", detail: "Vault checks received balance delta", ms: 1500 },
  { key: "insert", label: "Wait for tree insertion", detail: "Indexer picks up the commitment event", ms: 1300 },
] as const;

export const withdrawStages = [
  { key: "sync", label: "Sync Merkle root", detail: "Local tree matched against indexer and chain", ms: 900 },
  { key: "path", label: "Build inclusion path", detail: "Path computed locally from public leaves", ms: 800 },
  { key: "witness", label: "Compute witness", detail: "Note secret stays in this tab", ms: 1200 },
  { key: "prove", label: "Generate proof", detail: "Client-side prover, no remote service", ms: 3200 },
  { key: "verify", label: "Verify locally", detail: "Checked against the verifier key before sending", ms: 700 },
  { key: "submit", label: "Submit withdrawal", detail: "Nullifier marked spent before transfer", ms: 1400 },
] as const;

export const privacyBoundaries = [
  { item: "Asset and denomination", publicAmm: "Visible", shielded: "Visible" },
  { item: "Deposit transaction and sender", publicAmm: "Visible", shielded: "Visible" },
  { item: "Withdrawal recipient", publicAmm: "Visible", shielded: "Visible" },
  { item: "Timing of each transaction", publicAmm: "Visible", shielded: "Visible" },
  { item: "Which deposit funded a withdrawal", publicAmm: "Visible", shielded: "Hidden among the anonymity set" },
  { item: "Note secret and nonce", publicAmm: "Not applicable", shielded: "Never leaves your device" },
  { item: "Vault's aggregate LP position", publicAmm: "Visible", shielded: "Visible" },
  { item: "Swap size, route, price impact", publicAmm: "Visible", shielded: "Not offered yet" },
];

export const shieldedWarnings = [
  "Lose the note and the funds are unrecoverable. No one, including ZKBLAST, can restore it.",
  "Withdrawing soon after depositing, or with an unusual amount, makes your deposit easy to link.",
  "This vault runs on testnet with unaudited contracts. Do not use real funds.",
];
