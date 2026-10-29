# ZKBLAST

**Zero-knowledge liquidity infrastructure for Robinhood Chain.**

| | |
|---|---|
| **ZKBLAST token CA** | `0x3f9ff9f1d40369f99c281375bd19d6ecbebfecd7` |
| **Application** | [zkblast.tech](https://zkblast.tech/) |
| **X** | [@zkblast9](https://x.com/zkblast9) |
| **Network** | Robinhood Chain · Chain ID `4663` |
| **License** | [Apache License 2.0](LICENSE) · Copyright © 2026 ZKBLAST |

ZKBLAST combines public market execution with a shielded liquidity layer. Users can swap, provide liquidity, manage LP positions, and create pools through public DAMM and DLMM markets, or move supported assets into private notes and authorize execution with zero-knowledge proofs.

## The protocol

ZKBLAST has two interoperable execution lanes:

- **Public liquidity** provides transparent, onchain swaps and LP positions through DAMM and DLMM pools.
- **Shielded liquidity** represents deposited assets and private LP positions as commitments in an incremental Merkle tree. Spending a note requires a valid proof and consumes a unique nullifier.

Both lanes settle against the same onchain pools. Oracle and reference prices provide market context, while executable quotes always come from current pool state.

## Zero-knowledge architecture

### Private notes

A private note binds its owner secret to its network, settlement contract, tree version, resource, and amount. The resulting commitment is inserted into the onchain commitment tree; the underlying secret remains in the user's encrypted browser journal.

Notes can represent:

- fungible token balances;
- DAMM liquidity positions;
- DLMM liquidity positions bound to a specific price bin.

### Proofs and nullifiers

ZKBLAST uses Groth16 proofs generated from versioned Circom circuits. A proof establishes that the user owns an eligible note and that the requested state transition satisfies the protocol constraints without publishing the note secret.

Every spend derives a unique nullifier. The settlement contracts reject reused nullifiers, preventing the same private note from being spent twice.

### Proof-bound execution

Private swap and liquidity intents bind the proof to the complete execution context, including:

- chain and settlement contract;
- commitment-tree version and Merkle root;
- action and pool model;
- pool, assets, amounts, and DLMM bin when applicable;
- input nullifiers;
- output and refund commitments;
- pool inflows, outflows, fees, and deadline.

The reservation and settlement lifecycle keeps execution atomic: a valid intent either settles against the selected pool and creates its protected output notes, or follows the defined recovery path.

### Cryptographic stack

- **Circom 2.2.3** for versioned constraint systems;
- **Groth16 / snarkjs** for proof generation and Solidity verification;
- **Poseidon2 over BN254** for note commitments, nullifiers, and Merkle hashing;
- **32-level incremental commitment trees** anchored onchain;
- domain-separated hashes for note, nullifier, Merkle, and action contexts;
- browser-side proving with encrypted local recovery journals.

## Liquidity models

### DAMM

DAMM uses deterministic constant-product execution with dynamic fee accounting. It is designed for general-purpose token pairs, conventional LP shares, and predictable onchain settlement.

### DLMM

DLMM organizes liquidity into discrete price bins. Swaps traverse available bins, while liquidity positions remain bound to their selected bin. ZKBLAST resolves the active bin from live pool state and includes the chosen bin in private proof statements.

## Shielded user flow

```text
Asset deposit
    ↓
Private commitment inserted onchain
    ↓
Encrypted note stored in the user's recovery journal
    ↓
Proof generated locally in the browser
    ↓
Nullifier reserved and private intent submitted
    ↓
Atomic pool execution
    ↓
Protected output/refund commitments inserted onchain
    ↓
Private note can be spent again or withdrawn to the wallet
```

Supported shielded actions include:

- private deposit and withdrawal;
- private DAMM and DLMM swaps;
- private liquidity addition;
- private liquidity removal;
- encrypted journal backup and validated restore;
- intent settlement and expired-intent recovery.

## Onchain guarantees

ZKBLAST contracts enforce the protocol's critical state transitions:

- proof verification before protected state is accepted;
- Merkle-root eligibility and commitment uniqueness;
- nullifier uniqueness and replay protection;
- proof-bound pool, asset, amount, fee, and deadline validation;
- atomic DAMM/DLMM settlement;
- asset-level vault accounting and solvency checks;
- upgrade authorization through governed UUPS proxies;
- network-isolated deployment manifests for mainnet and testnet.

The browser never needs a private key, seed phrase, database credential, or RPC credential from the ZKBLAST server. Wallets sign their own authentication and transaction requests, while note secrets and journal passphrases remain local to the user.

## Public verification

Core execution, commitment insertion, nullifier consumption, pool interaction, and settlement are recorded on Robinhood Chain. Transaction hashes exposed by the application link directly to the network explorer so users can independently verify execution.

The source repository includes the protocol contracts, circuit sources, deterministic proof vectors, public deployment manifests, and the client logic required to reproduce protocol statements. Generated witnesses, proving keys, private recovery material, credentials, and operational evidence are intentionally excluded from version control.

## Security

ZKBLAST treats proofs, manifests, and network context as versioned protocol inputs. A proof created for another chain, settlement contract, tree version, pool, action, asset, amount, or deadline is not valid for the active execution context.

Cryptographic correctness does not remove smart-contract, market, wallet, or operational risk. Verify the selected network, pool, assets, amounts, and transaction details before signing, and keep encrypted recovery material available for every unspent private note.

## License

ZKBLAST is open-source software released under the [Apache License 2.0](LICENSE).

Copyright © 2026 ZKBLAST.

---

**ZKBLAST** · Private liquidity, verifiable execution.
