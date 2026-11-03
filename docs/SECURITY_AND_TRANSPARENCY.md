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

## Protected Launch controls

Protected Launch is an isolated launch path for address-level concentration
limits, deterministic buy-fee decay and policy-bound liquidity locks. Existing
Standard DBC launches are not migrated into this path automatically.

The deployed policy records the protection duration, maximum output per
transaction, cumulative output per recipient, initial and base buy fees, and
creator LP unlock time. Policy economics are immutable after creation. A policy
can be disabled for future selection without rewriting launches that already
reference its hash.

| Component | Robinhood Chain mainnet address |
|---|---|
| Protected Launch Factory | `0x98D8546bb60d4d5fF791fB6b904A611691D86beF` |
| Protected Launch Router | `0xdb95b8CEe663baAd9dF839171e353265aF2884AA` |
| Protection Policy Registry | `0xAA4b3B6A3Dab4C42b0FE501dEF47aB77099C4a7f` |
| Canonical Identity Registry | `0x0AA5D2dbDa6beA6fbBdCFE768106a614ec9382F2` |
| Protected LP Escrow | `0xec2a8A4A20364ffB912aA5bf3eaC817e708B9FD7` |
| Protected Graduation Manager | `0xE83203279e4e8Db4Aa747213aC28260418Ff2E83` |
| DAMM Graduation Adapter | `0x4D78A76696b4AdB62aC1843Fb9ddB2E2312E5910` |
| DLMM Graduation Adapter | `0x28A31686370Fd1490EDB2C7221f7C3c46847d835` |

The corresponding public Solidity sources are grouped under
[`packages/contracts/src/launchpad/protection`](https://github.com/ZKBLAST/zkblast/tree/main/packages/contracts/src/launchpad/protection)
and the Protected pool and graduation implementation under
[`packages/contracts/src/dbc`](https://github.com/ZKBLAST/zkblast/tree/main/packages/contracts/src/dbc).
The active application reads these addresses from the chain-specific deployment
manifest instead of embedding them in UI components.

The concentration limit is recipient-address based. It applies consistently to
canonical direct-pool and router purchases, including bundled calls, but does
not claim that multiple independent addresses belong to one human. Creator LP
principal remains in the escrow until its recorded unlock time; fee liabilities
are accounted separately from that principal.

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
