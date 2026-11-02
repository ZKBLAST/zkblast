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
