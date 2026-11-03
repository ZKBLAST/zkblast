# ZKBLAST Security and Transparency

**Last updated:** 2026-11-03

ZKBLAST uses chain-specific deployment manifests, versioned zero-knowledge
circuits and explicit execution domains. This page explains the security model
and gives users concrete references for independently inspecting protocol
activity.

## Security architecture

- Proof statements are bound to their chain, settlement contract, circuit
  version, action, asset or market, amounts, output commitments and deadline.
- Nullifiers prevent the same protected note from being spent twice within its
  execution domain.
- Merkle-root validation binds each protected spend to a commitment accepted by
  the active contract.
- Asset-level accounting keeps token liabilities separated; one asset's
  balance is not used as another asset's backing.
- Contract upgrades, verifier registration and adapter authorization use
  explicit governance roles and emit onchain transactions.
- The browser keeps note secrets, journal plaintext and proof witnesses inside
  the encrypted local workflow.

## Feature and network scope

| Feature | Robinhood Chain | HyperEVM | Execution model |
|---|---|---|---|
| DAMM/DLMM pools | Supported | Supported according to active network configuration | Public onchain execution |
| DBC and launchpads | Supported | Supported | Public onchain execution |
| Shielded notes and withdrawal | Supported | — | Proof-authorized note transition |
| Shielded swap and private LP | Supported | — | Proof-bound intent and protected output notes |
| Perpetual positions | Supported | — | Public or proof-authorized position execution |

Network selection changes the chain ID, native/quote assets, contract manifest,
explorer and indexed data source. Addresses and capabilities are never copied
between chains implicitly.

## Privacy boundaries

Shielded execution protects ownership secrets and proof witnesses. The public
chain continues to record the transaction context needed for settlement,
including contract interactions, block timing, gas payer and resulting public
state changes. Public swaps, public LP positions, launchpad trades and their
amounts remain public onchain.

The effective privacy set depends on other eligible actions with compatible
network, circuit, asset, action and timing characteristics. Users should keep
their encrypted recovery journal available for every unspent private note.

## Verifiable deployment references

The application contract directory is generated from the active API deployment
manifest. It displays:

- network name and chain ID;
- full proxy and implementation addresses;
- deployment and upgrade transaction references;
- direct explorer links;
- compiler and runtime artifact identities exposed by the manifest.

Use the proxy address for integrations with upgradeable contracts. The proxy
remains the integration address while its implementation identity can change
through the governed upgrade process.

## Circuit identity

Circuit releases bind the public constraint source to the compiled R1CS, WASM,
proving key, verification key and generated Solidity verifier through recorded
artifact hashes. The application selects artifacts for the active network and
action, while the onchain verifier checks the corresponding public-input
schema before accepting a protected transition.

## User verification checklist

1. Confirm the network name and chain ID shown by the application and wallet.
2. Inspect the complete contract address through the contract directory.
3. Review the transaction target, assets, amounts, deadline and recipient before
   signing.
4. Open the transaction hash in the configured explorer after confirmation.
5. Keep note secrets and journal passphrases private and retain an encrypted
   recovery backup for every spendable private note.

Security-sensitive reports should be shared through a private communication
channel with the affected chain, block, address and a non-destructive technical
description. Credentials, note secrets, witnesses and recovery material must
never be included.
