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
            note: "Shielded availability follows the active network's vault, approved denomination and prover configuration. The interface reads operational protocol values from the configured API and chain indexer.",
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
    group: "Launchpad",
    sections: [
      {
        id: "curve-launches",
        title: "Dynamic bonding curve launches",
        body: [
          "Launch uses governance-approved templates. A template fixes the quote asset, token inventory, curve, trade fee, graduation threshold, DAMM fee tier, terminal-price tolerance and LP allocation policy before a token is created.",
          {
            list: [
              "Create Launch guides you through the template, token metadata, recipient and final wallet confirmation.",
              "Buy and sell quotes come from the active virtual pool. Refresh a quote whenever its deadline or market context changes.",
              "The progress bar is calculated from real net quote reserves against the onchain graduation threshold.",
              "Recorded OHLCV contains validated curve swaps only; an empty period has no manufactured volume.",
            ],
          },
        ],
      },
      {
        id: "curve-graduation",
        title: "Graduation and LP allocation",
        body: [
          "At the exact threshold, curve trading freezes. Any account may trigger the configured migration, but the caller cannot change its DAMM pair, fee tier, price tolerance, minimum shares or asset recipients.",
          "Destination LP shares are recorded in escrow. Creator and protocol allocations can only be claimed by their configured recipients, and creator claims respect the onchain unlock time.",
          {
            note: "A graduation or claim button prepares the canonical contract call. Your wallet simulation remains authoritative; verify the network, amounts and destination before signing.",
          },
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
          "Shielded notes hide their secret ownership witness. A valid proof can authorize withdrawal, swap, liquidity or supported perps state transitions without publishing that witness. Privacy remains conditional on the effective anonymity set and on timing, amount and network metadata not singling the action out.",
          {
            list: [
              "Protected locally: note secrets, recovery-journal plaintext and proof witnesses.",
              "Proof-bound: chain, vault, action, pool or market, assets, amounts, output commitments and deadline.",
              "Visible onchain: transaction timing, gas payer and public settlement effects required by the selected action.",
              "Network scope: Robinhood Chain provides the Shielded and Perps execution lanes; HyperEVM provides its configured public pool and launchpad execution.",
            ],
          },
          {
            note: "The signing summary shows the public execution context while note secrets and proof witnesses stay in the encrypted browser workflow.",
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
          "Core invariants: vault liabilities remain asset-backed, each nullifier is consumed once, and every accepted proof maps to a registered circuit version and public-input schema.",
        ],
      },
      {
        id: "verification",
        title: "Verification and source of truth",
        body: [
          "ZKBLAST publishes source, deployment receipts, chain-specific manifests and cryptographic artifact identities so integrations can resolve the active protocol configuration from one source of truth.",
          {
            list: [
              "The contract directory follows the network selected in the application and displays complete proxy and implementation addresses.",
              "Deployment manifests record chain ID, deployment transactions, compiler configuration and runtime bytecode identities.",
              "Circuit releases bind source, R1CS, WASM, proving key, verification key and generated verifier identities.",
              "Explorer links allow each address and transaction to be inspected directly on its active chain.",
            ],
          },
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
