export type DocSection = {
  id: string;
  title: string;
  body: (string | { list: string[] } | { code: string } | { note: string })[];
};

export const docs: { group: string; sections: DocSection[] }[] = [
  {
    group: "Start",
    sections: [
      {
        id: "overview",
        title: "Overview",
        body: [
          "ZKBLAST is a liquidity protocol with two lanes. The public lane runs DLMM (discrete bins) and DAMM (dynamic-fee constant product) pools: swaps, liquidity and fees are fully visible onchain, like any AMM. The shielded lane is a vault where a deposit becomes a private note, and a later withdrawal proves ownership of an unspent note without revealing which deposit it was.",
          "The two lanes are kept apart on purpose. A zero-knowledge verifier on its own does not make a public token transfer, a swap amount or an LP bin private, so the app never shows a privacy badge on a public action.",
          {
            note: "Shielded custody actions remain disabled until the vault contract is deployed and indexed. The interface does not display synthetic protocol values.",
          },
        ],
      },
    ],
  },
  {
    group: "Public lane",
    sections: [
      {
        id: "dlmm",
        title: "DLMM pools",
        body: [
          "Liquidity sits in discrete price bins. Each bin has a fixed price; only the active bin holds both tokens. Bins to the left of the active bin hold the quote token and bins to the right hold the base token.",
          {
            list: [
              "Bin step sets the price gap between neighbouring bins, in basis points.",
              "Spot spreads liquidity evenly, Curve concentrates it near the active bin, Bid-Ask weights the edges.",
              "A position only earns fees while the active bin is inside its range.",
            ],
          },
        ],
      },
      {
        id: "damm",
        title: "DAMM pools",
        body: [
          "Full-range constant-product pools with a fee that widens during volatility. Good for long-tail pairs and passive liquidity.",
        ],
      },
      {
        id: "swaps",
        title: "Swaps and slippage",
        body: [
          "The router quotes across DLMM and DAMM pools and shows the route, price impact, minimum received and the fee. Your slippage tolerance sets the minimum received; the transaction reverts if the price moves past it.",
        ],
      },
    ],
  },
  {
    group: "Shielded lane",
    sections: [
      {
        id: "notes",
        title: "Notes and commitments",
        body: [
          "When you deposit, your browser creates a secret and a nonce. The commitment, a hash of chain ID, vault, asset, amount, secret and nonce with domain separation, is inserted into an onchain Merkle tree. The note (the secret material) never leaves your device unless you export an encrypted backup.",
          {
            note: "If you lose the note, the deposit cannot be recovered by anyone.",
          },
        ],
      },
      {
        id: "withdraw",
        title: "Withdrawing",
        body: [
          "To withdraw, your browser proves that the note's commitment is in the tree under an accepted root and reveals a nullifier derived from the secret. The contract checks the root, rejects reused nullifiers, checks asset, amount, recipient, chain and deadline, marks the nullifier spent, then transfers.",
        ],
      },
      {
        id: "privacy",
        title: "Privacy guarantees",
        body: [
          "What the MVP hides: the link between a specific deposit and a specific withdrawal, as long as the anonymity set is large and your timing and amount do not single you out.",
          {
            list: [
              "Still public: asset, denomination, deposit sender, withdrawal recipient, timing, gas payer.",
              "Still public: the vault's aggregate LP position and its changes.",
              "Not offered: private swaps. These sit behind a separate research gate.",
            ],
          },
        ],
      },
    ],
  },
  {
    group: "Security",
    sections: [
      {
        id: "threat-model",
        title: "Threat model",
        body: [
          {
            list: [
              "Stolen or leaked notes",
              "Malicious prover, relayer or compromised frontend",
              "Replay across chains or vaults",
              "Incorrect Merkle roots and chain reorganisations",
              "Toxic ERC-20 behaviour, reentrancy, rounding",
              "Proof malleability and oracle manipulation",
              "Governance or admin key compromise",
            ],
          },
          "Invariants under test: vault liabilities never exceed vault assets, no note redeems twice, and every accepted proof maps to a registered circuit version and public-input schema.",
        ],
      },
      {
        id: "deployments",
        title: "Deployments",
        body: [
          "The contract directory below is loaded from the active API deployment manifest. It automatically follows the configured testnet or mainnet service; addresses are not embedded in the web bundle.",
          {
            list: [
              "Use the proxy address for integrations and transactions. It remains stable across upgrades.",
              "The implementation address identifies the currently deployed logic and can change after an approved upgrade.",
              "Direct contracts have no proxy; their contract and implementation addresses are the same.",
              "Always confirm the network name and chain ID before copying an address or signing a transaction.",
            ],
          },
          {
            note: "A full address is intentionally shown without truncation. Copy it with the adjacent button, then verify it against the linked block explorer before use.",
          },
        ],
      },
    ],
  },
];
