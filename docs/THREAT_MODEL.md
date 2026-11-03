# ZKBLAST Threat Model

## Protected assets

User tokens held by the vault, note secrets and nonces, unspent-note ownership, nullifier uniqueness, accepted Merkle roots, verifier/version integrity, governance roles, and the availability of encrypted note backups.

## Trust boundaries

- Vault and verifier contracts are authoritative for balances, roots, nullifiers, deadlines, and proof validity.
- The browser constructs notes and proofs but is not trusted by contracts.
- API, indexer, RPC, relayer, analytics, and frontend hosting are untrusted for validity and privacy.
- Governance can pause, allowlist assets, and register reviewed verifier versions; it cannot recover a lost note secret.

## Threats and required controls

- Stolen note: possession permits spending. Encrypt at rest, support explicit backup/restore, never upload plaintext witnesses.
- Compromised frontend: may substitute recipient or exfiltrate secrets. Display and locally confirm public inputs, pin assets, use CSP/subresource controls, and support independent artifact verification.
- Malicious prover: cannot bypass constraints; altered proof or input must fail. Negative vectors are mandatory.
- Malicious relayer: may censor or observe network metadata but cannot change bound recipient, fee, deadline, chain, vault, or action.
- Replay: bind chain/vault/version/action and consume the nullifier exactly once before transfer.
- False or stale Merkle path: contract accepts only a root in its bounded authoritative history.
- Proof malleability/underconstraint: pin patched toolchains, review generated verifier, fuzz public inputs, and audit every circuit version.
- Toxic ERC-20: reject fee-on-transfer/rebasing behavior unless explicitly supported; verify received balance deltas and use reentrancy protection.
- Governance compromise: separate admin/upgrader roles, timelock production changes, publish verifier hashes, and expose pause/version events.
- RPC/indexer compromise: never use them for validity; cross-check roots against contract and retain reorg-safe canonical processing.
- Timing and amount analysis: explicitly not solved in v1; recommend denomination strategy/relayer only after a separate privacy review.

## Shielded v2 action boundary

Robinhood Chain v2 provides proof-authorized note transitions for supported
swaps, liquidity actions and private perps. Proof verification protects the
statement and note ownership rules; it does not hide all downstream public
settlement effects. Direction, route, amount characteristics, price impact,
execution block, relayer/gas metadata and reserve changes can enable timing or
amount correlation.

Solver or relayer censorship, intent withholding, MEV, manipulated or stale
prices, false anonymity-set claims, refund races, chain reorganizations,
metadata leakage and fee manipulation remain in scope. HyperEVM does not
inherit this v2 boundary without separate deployed contracts and evidence.
- Denial of service: cap proof/calldata sizes, bound root history and tree depth, rate-limit APIs, and provide alternate RPC/indexer paths.
- LP loss or rounding deficit: value each asset independently with downward rounding, require a governance-funded non-liability reserve, expose solvency, prevent investment that is already insolvent, and retain pause/divest/recapitalization procedures.
- LP metadata correlation: treat the aggregate pool position, reserves, shares, amounts, blocks, timing, governance actions, and gas payer as public. Never market aggregate LP activity as private.
- Lost backup: funds are unrecoverable by design. The UI must require an acknowledged encrypted backup before treating a deposit as safely completed.

## Security invariants

No withdrawal without a valid proof and accepted root; no nullifier twice; no proof across domain boundaries; no transfer before nullifier consumption; no unsupported token accounting; no secret in events, logs, API, database, analytics, crash reports, or URLs.

For the proposed aggregate LP manager, each asset must satisfy `liquid vault balance + conservatively redeemable manager balance >= note liabilities` before investment completes. A surplus in another asset cannot satisfy this invariant.

## Governance controls

Governance, verifier registration, adapter authorization and upgrade execution
are separate control domains. Production changes use explicit roles,
chain-specific manifests, transaction receipts and implementation identities so
each change can be independently inspected against its deployed network.
