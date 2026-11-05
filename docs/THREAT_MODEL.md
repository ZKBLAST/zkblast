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

## Protected Launch anti-concentration boundary

Protected Launch enforces maximum output per transaction and cumulative output
per recipient during the configured protection window. The bound is applied to
the actual token recipient, including direct-pool, router, contract-wallet and
same-transaction bundled execution. Dynamic fees and creator LP locks are also
enforced by the deployed contracts rather than API or UI state.

The per-address allocation is not proof of unique human identity. A participant
controlling multiple independent addresses can receive one allocation per
address. The interface therefore presents the control as an address-level
concentration bound and never as Sybil prevention. Canonical token, policy,
runtime-code and LP-lock identities remain independently inspectable onchain.

## Tokenized-stock quote-asset boundary

Tokenized-stock support is authorized by chain ID and contract address, never
by ticker, name, artwork or frontend catalog state. ZKBLAST does not issue the
stock token and does not treat it as custody of an underlying share. Issuer
identity, token mechanics, decimals, multiplier, oracle policy, market session,
exposure limits and destination capability are independent controls.

The primary threats are a substituted token with a familiar ticker, stale or
manipulated oracle data, an outdated issuer multiplier, market-session bypass,
fee-on-transfer or rebasing behavior, reserve/fee accounting drift, an
unreviewed graduation destination, and a privileged attempt to divert quote
reserves. The required controls are address-bound registry entries, exact
balance-delta transfers, bounded notional exposure, fail-closed oracle/session
validation, immutable event-time policy receipts, separate DAMM and DLMM
capability receipts, and atomic reserve migration.

Pause, delisting, issuer halt and emergency mode block new exposure without
turning user exits or legitimate claims into administrator-controlled funds.
Creator, partner, protocol and LP fees remain separate liabilities in the
native quote token. An unsupported stock-token Assistance Fund route accrues in
an isolated ledger and cannot be converted or burned without a separately
approved bounded route.

An API, indexer or frontend may display stale metadata but cannot authorize an
asset, market session, trade or graduation. Wallets sign state changes and the
contracts enforce the current address-bound policy. Public analytics preserve
raw token units and record validated USD observations separately; a reference
chart price is never an executable quote or authorization signal.

### Stock-quote privilege graph

- The Safe and timelock may update reviewed registry, oracle and destination
  policies, but have no transfer path for user quote reserves or fee claims.
- `StockQuoteAssetRegistry` authorizes an exact chain/address/version tuple; a
  symbol, logo or API record has no authorization power.
- `StockQuoteOracleGuard` validates the approved feed, session, heartbeat,
  multiplier and exposure bounds without holding user assets.
- Launch and Protected Launch factories bind creation and execution to those
  policy identities. Routers and pools perform exact-delta transfers and own
  the reserve accounting boundary.
- `StockQuoteDestinationRegistry` grants DAMM and DLMM capability independently;
  neither the API nor governance metadata can manufacture a migration receipt.
- The indexer, API and web application are read/projection layers. They can be
  unavailable or stale, but cannot authorize trades, move reserves or rewrite
  event-time policy receipts.
