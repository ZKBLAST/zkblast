# ZKBLAST Privacy Guarantees

## v1 guarantee

Given sound circuit/backend implementations and an uncompromised user device, a valid withdrawal proves ownership of one deposited note without revealing its secret, nonce, leaf index, Merkle path, or an explicit deposit-to-withdrawal identifier.

## Public information

Deposits reveal sender, vault, asset, amount, commitment, leaf index, block, and timing. Withdrawals reveal vault, asset, amount, recipient, relayer, relayer fee, nullifier, root, deadline, block, and timing. The public inputs deliberately expose these values to keep conservation and authorization enforceable in v1.

## Privacy scope

- Amount privacy, asset privacy, recipient privacy, timing privacy, IP/network privacy, or anonymity against statistical correlation.
- Privacy when the frontend, browser extension, operating system, RNG, note backup, or clipboard is compromised.
- Recovery of a lost note secret or password.
- Protection from a recipient or relayer voluntarily identifying the user.

## v2 private-action boundary

Shielded v2 implements proof-authorized note transitions for supported swaps,
liquidity actions and private perps on Robinhood Chain. The proof hides note
secrets and binds the protected state transition to its chain, vault, action,
pool or market, assets, amounts, output/refund commitments and deadline.

This does not make the public settlement venue invisible. Pool or market
context, timing, gas payer, relayer metadata, aggregate reserve changes and
other state effects can remain observable and correlatable. Public AMM swaps
and public LP positions remain fully public. HyperEVM has no shielded or perps
privacy claim unless a separate chain-specific deployment and evidence set is
published.

No minimum anonymity-set size is guaranteed. Effective anonymity depends on
the eligible actions sharing the same chain, circuit/version, asset/action,
amount characteristics and timing window—not the total number of historical
deposits.

## Operational requirements

Secrets are generated and encrypted locally, never sent to ZKBLAST services, and never placed in browser storage without encryption. Analytics must exclude note material and proof witnesses. Every UI release must show the exact public fields before proof generation and must not describe v1 as fully private, anonymous, or confidential.

The public aggregate LP manager remains distinct from v2 private LP notes. Its
pool position and accounting effects are public. Accounting and restrictions
are defined in `SHIELDED_LP_ACCOUNTING.md`.

Feature-to-chain scope and user-verifiable protocol references are documented
in `SECURITY_AND_TRANSPARENCY.md`.
