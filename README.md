# ZKBLAST

Zero-Knowledge Liquidity Infrastructure for Robinhood Chain.

## Monorepo layout

```text
apps/
  web/          Next.js product application
  api/          read API and transaction status service
  indexer/      reorg-aware chain event ingestion
  keeper/       explicitly approved operational jobs
packages/
  abi/          generated protocol ABIs
  config/       runtime and deployment validation
  contracts/    Foundry contracts, tests, and deployment scripts
  circuits/     versioned circuits and proof vectors
  sdk/          typed protocol client
  ui/           shared ZKBLAST design system
  database/     schema-qualified Supabase access
  observability/ redacted logs, metrics, and alerts
```

All applications and packages are maintained in this single workspace.

## Environment model

ZKBLAST uses explicit network configuration. Copy and complete the ignored `.env.testnet` and `.env.mainnet` files from their tracked examples. Application code must not contain network-specific addresses or endpoints.

```bash
pnpm check:env:testnet
pnpm dev:testnet
```

Contract addresses are read from `deployments/<environment>/manifest.json`. A manifest is accepted only when its environment and chain ID match the active runtime configuration.

## Development checks

Run focused checks for the package being changed. The full workspace build and critical E2E suites are reserved for PR and release gates.

```bash
pnpm check:brand
pnpm --filter @zkblast/config typecheck
```

See [the development roadmap](docs/DEVELOPMENT_ROADMAP.md) for the ordered delivery slices and security gates.
