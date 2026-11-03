# Independent branded launchpad starter

Copy `.env.example` to `.env`, set the public ZKBLAST API URL for the selected
environment, install dependencies and run `pnpm dev`. The application resolves
chain identity and public capabilities from `/v1/config`; it contains no private
URL, credential, custody key, or hardcoded contract address.

Extend the same `LaunchpadApiClient` with wallet-submitted calls prepared by
`LaunchpadClient`/`DbcClient` for create launchpad, token launch, buy/sell and fee
claim. Read trades and graduation from the indexed API after confirmation.

`src/flow.ts` provides the executable `PublicLaunchpadFlow`: every mutation is
encoded from the public ABI and sent through the connected EIP-1193 wallet. It
checks the wallet chain before every transaction, applies balance, allowance,
deadline, quote-age and slippage preflight to buys, polls canonical indexed
trades by transaction hash, claims a revenue snapshot and reads graduation.
The starter also demonstrates a chain-bound SDK client for Robinhood Chain and
HyperEVM. The host application injects its public/wallet client; no RPC
credential is embedded in source.

HyperEVM capabilities are fail-closed. A client can display chain information
now, but launch/trade/graduation calls must remain disabled until the chain
descriptor and deployment manifest advertise the corresponding capability.

`futureDeadline()` creates a nonzero future deadline and rejects windows below
30 seconds. Transaction examples must still refresh quotes immediately before
wallet signing.
