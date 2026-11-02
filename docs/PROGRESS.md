# Development Progress

## 2026-10-19 — Cross-page external-market reconciliation complete locally

Status: Shielded, Analytics, Positions, Pools, and Swap reconciliation is **100%** complete locally. Overall explicit roadmap completion is approximately **96%** (`142/148`).

- Shielded now filters internal regression assets fail-closed. Because the deployed vault currently exposes only ZKTB, deposit/withdraw controls remain unavailable until governance configures a real user-facing asset; the UI never relabels a contract address as USDG.
- Pools now lists the five validated external execution pools with pair logos, pool addresses, venues, raw liquidity, and explorer links instead of showing an empty filtered generic pool list.
- Analytics now reports real listed-market coverage, validated route count, indexer lag, and the active execution-route directory instead of generic empty protocol counters.
- Positions remains wallet-scoped and internal-asset filtered, and now explains that swaps produce trade-history receipts rather than LP positions.
- Swap now shows authenticated, receipt-derived per-user trade history instead of the empty generic swap feed, while its execution selector remains restricted to the five validated Stock Token/USDG routes.

Validation:

- Web typecheck and lint passed.
- Web tests passed `14/14`.
- Local route smoke tests returned HTTP `200` for `/shielded`, `/analytics`, `/positions`, `/pools`, and `/swap` after successful compilation.
- Live quote smoke tests had already returned HTTP `200` for AMD/USDG, NFLX/USDG, PLTR/USDG, TSLA/USDG, and AMZN/USDG.

Owner action required:

- Redeploy the web service to publish this reconciliation.
- Enabling a public Shielded asset is a separate governance/contract task. Do not test Shielded deposits until a non-internal asset is explicitly configured and verified in the deployment manifest.

## 2026-10-19 — Wallet disconnect and external-market swap UI complete locally

Status: this web transaction slice is **100%** complete locally. Overall explicit roadmap completion remains approximately **97%** (`141/147`).

- Added `Disconnect wallet` to the wallet modal. It revokes the server session and requests `wallet_revokePermissions`; providers without that method receive an explicit manual-disconnect notice rather than a false success claim.
- Audited live state: the generic protocol pool endpoint contains only the internal ZKTB/ZKTA regression pool, while five external markets have independently validated execution routes.
- Removed the legacy `SwapCard` that bypassed the internal-asset filter and replaced `/swap` with the validated external-market selector.
- The transaction UI now offers AMD/USDG, NFLX/USDG, PLTR/USDG, TSLA/USDG, and AMZN/USDG. Reference-only markets remain visible elsewhere but cannot generate calldata.
- Confirmed all five live testnet quote endpoints return HTTP `200` with their expected pool identifiers; no transaction or signature was submitted during validation.

Validation:

- Web typecheck and lint passed.
- Web tests passed `14/14`.
- Diff whitespace validation passed.

Owner action required:

- Deploy the web service again to publish this new disconnect action and market swap selector. No API, database, contract, or environment change is required.

## 2026-10-19 — Execution pair label corrected to USDG

Status: pair-label correction is **100%** complete locally. Overall explicit roadmap completion remains approximately **97%** (`140/146`).

- Identified that the UI rendered the reference-market denomination (`quoteSymbol=USD`) instead of the execution candidate quote (`USDG` or `WETH`).
- Centralized pair selection so a validated route wins, followed by the first planned candidate, with the reference quote used only when no execution candidate exists.
- Applied the same selected candidate to accessible logo labels and visible market pair text.
- Preserved USD as the legitimate oracle/reference denomination without presenting it as an on-chain trading asset.

Owner action required:

- No database or environment action is required.
- The correction will be included in the pending web-only Railway release.

## 2026-10-19 — Quote asset logos and adaptive circular rendering complete

Status: quote-logo task is **100%** complete locally and in the testnet database. Overall explicit roadmap completion remains approximately **97%** (`139/145`).

- Registered the owner-provided USDG, WETH, and future ETH image URLs in one reusable indexer source.
- Updated all `104` testnet external-market records transactionally with merged `quoteLogos` metadata; the first failed validation rolled back completely before the corrected typed JSONB transaction succeeded.
- Confirmed the live API now returns the new USDG and WETH URLs for current pair candidates. ETH is stored for future ETH candidates and remains absent from the API until such a pair exists.
- Added intrinsic image-ratio detection: nearly square artwork fills and receives a light zoom inside the white circular crop; non-square artwork keeps the existing contained presentation.

Validation:

- All three remote URLs returned HTTP `200` with valid PNG or WebP content types.
- Indexer and web typechecks plus lint passed.
- Web tests passed `13/13`, including square/non-square rendering classification and wallet verify payload regression coverage.
- Diff whitespace validation passed.

Owner action required:

- No environment or database action is required.
- A web-only Railway deployment is still required to publish the adaptive renderer, wallet verify fix, connected-address header, and Quickstart removal.

## 2026-10-19 — Wallet verify payload defect repaired locally

Status: production wallet-login defect is **100% repaired locally**. Overall explicit roadmap completion remains approximately **96%** (`138/144`).

- Identified the live HTTP `400` cause: the web spread the challenge response into the strict verify request, unintentionally sending `expiresAt` as an unsupported field.
- Replaced the spread with an explicit allowlisted payload containing only `challengeId`, `walletAddress`, `message`, and `signature`.
- Updated the unauthenticated header state to show the connected extension address instead of the generic `Sign in` label; selecting it still opens the signature flow required to create a ZKBLAST session.

Owner action required:

- No environment value or API change is required.
- A web-only Railway deployment is required before this fix is live.

## 2026-10-19 — User-facing docs scope cleanup complete locally

Status: documentation cleanup is **100%** complete locally. Overall explicit roadmap completion remains approximately **96%** (`137/143`).

- Removed the complete developer-oriented `Quickstart` section from the public web documentation.
- Removed local installation commands and internal implementation copy from the user-facing navigation and content.
- Preserved product usage, security, privacy, network, and deployed-contract guidance intended for ZKBLAST users.

Validation:

- Targeted formatting and diff whitespace validation passed.

Owner action required:

- No environment or configuration change is required.
- The cleanup requires a web-only Railway deployment before it appears on the hosted site.

## 2026-10-19 — Wallet-session and contract-directory Railway release complete

Status: the wallet-session repair and dynamic contract documentation are live on testnet Railway. Overall explicit roadmap completion remains approximately **96%** (`137/143`).

- Released API deployment `b5d245a3-43bb-48f6-846c-57390f6c72ac`; Railway reported `SUCCESS`.
- Released web deployment `e05e2c99-0330-4e93-bada-915377292adb`; Railway reported `SUCCESS`.
- Confirmed the live same-origin web endpoint `/api/v1/config` returns HTTP `200` and exactly matches the direct API response.
- Confirmed all 10 manifest contracts are published with their current proxy and implementation addresses.
- Confirmed the public config does not expose web-origin internals, operations token, RPC URL, or database URL.
- Confirmed the live web root returns HTTP `200`.

Owner action required:

- Perform one browser wallet sign-in: hard refresh the web, click `Sign in`, approve the requested testnet switch if shown, and sign the login message. Report the exact ZKBLAST toast code if the authenticated address still does not appear.

## 2026-10-19 — Railway wallet-session boundary repaired locally

Status: wallet-session repair is **100%** complete locally. Overall explicit roadmap completion remains approximately **96%** (`137/143`).

- Identified the misleading state boundary: the extension could report a connected account while ZKBLAST still lacked an authenticated backend session.
- Routed browser API calls through same-origin `/api/*`; Next.js resolves the upstream API from `API_URL` or the legacy `NEXT_PUBLIC_API_URL` on the server.
- Preserved the stronger `HttpOnly`, `Secure`, and `SameSite=Strict` session cookie rather than relying on third-party-cookie support between Railway domains.
- Added connected-account discovery and account-change handling. The UI now says `Sign in` and explicitly requests a login signature when the extension is connected but no ZKBLAST session exists.

Validation:

- Web typecheck and lint passed.
- Web tests passed `11/11`.
- Local `/api/v1/config` proxy smoke test returned HTTP `200` from the live testnet API.
- Diff whitespace validation passed.

Owner action required:

- No new value is required: the existing `NEXT_PUBLIC_API_URL` remains a supported proxy target. For the next environment cleanup, it can be renamed to server-only `API_URL` without changing application code.
- Released in web deployment `e05e2c99-0330-4e93-bada-915377292adb`; see the release entry above.

## 2026-10-19 — Dynamic deployed-contract documentation complete

Status: this documentation task is **100%** complete. Overall explicit roadmap completion remains approximately **96%** (`136/142`).

- Added a public, sanitized contract projection sourced from the deployment manifest selected by the API environment.
- Added a web contract directory showing the active environment, network, chain ID, complete proxy and implementation addresses, copy controls, explorer links, proxy type, and verification state.
- Kept all addresses dynamic: testnet and mainnet services automatically publish their own manifest without a web code change.
- Expanded user guidance for proxies, upgrades, network verification, and safe address usage.
- Corrected the root documentation ignore rule so private `/docs/` remains ignored without accidentally ignoring web source directories named `docs`.

Validation:

- API and web typechecks passed.
- API and web lint plus focused tests passed.

Owner action required:

- No environment value is required.
- Released through API deployment `b5d245a3-43bb-48f6-846c-57390f6c72ac` and web deployment `e05e2c99-0330-4e93-bada-915377292adb`.

## 2026-10-19 — Slice 18 Railway release complete

Status: the authoritative Stock Token classification release is live on the existing testnet Railway services. Roadmap completion remains approximately **96%** (`135/141`).

- Released indexer deployment `28ab319e-af6f-4f04-aae0-2a2ed4bf5732`; Railway reported `SUCCESS`.
- Released web deployment `a5c8e716-4001-4cc3-8b90-defc0fc39371`; Railway reported `SUCCESS`.
- Live API smoke checks returned exactly 5 issuer-verified US markets, 2 issuer-verified China markets, and 94 explicitly unclassified markets.
- Live web smoke check returned `200 text/html`, and the server-rendered output contains both `Verified external markets` and `Other / pending`.
- No API, contract, database migration, mainnet service, or environment-secret change was included in this release.

Owner action required:

- No immediate configuration action is required. Manual browser review of the market tabs and candidate logos can proceed on the deployed testnet web.

## 2026-10-18 — Slice 18 authoritative Stock Token classification complete

Status: Slice 18 is now **100%** (`6/6`); the current explicit roadmap is approximately **96%** (`135/141`).

- Replaced ticker-based country inference with a fail-closed issuer-evidence registry. Only AMD, AMZN, NFLX, PLTR, TSLA, BABA, and FUTU currently have approved US/China classifications; every other Stock Token remains `unclassified` until evidence is added.
- Stored an explicit classification basis, authoritative HTTPS issuer/issuer-filing source, source kind, and verification date for each classified symbol.
- Updated stock synchronization to persist the verified classification and provenance, while never turning an unknown ticker into a country classification.
- Added offline curation validation that rejects duplicates, altered reasons, incorrect regions, and missing or substituted provenance URLs before any database transaction.
- Reconciled the complete live testnet catalog of 101 Stock Tokens transactionally. Ninety-four unverified records remain correctly unclassified; no record is inferred from its symbol or company name.
- Kept unclassified markets visible in the web under `Other / pending` so evidence safety does not reduce catalog visibility.

Validation:

- Indexer tests passed `10/10`; indexer typecheck and lint passed.
- Web tests passed `11/11`; web typecheck and lint passed.
- The 101-record curation file passed fail-closed offline validation and was applied successfully to the testnet schema.
- Formatting and diff whitespace checks passed.

Owner action required:

- The Railway release was subsequently approved and completed on 2026-10-19; see the release entry above.
- Logo decisions remain intentionally pending for manual owner review; this task did not approve any logo URL.

## 2026-10-18 — Slice 00 independent regression baseline complete

Status: Slice 00 is now **100%** (`8/8`); the current explicit roadmap is approximately **95%** (`134/141`).

- Added versioned, credential-free JSON vectors for DAMM exact-input, DAMM exact-output, fee rounding, insufficient-liquidity rejection, and positive/negative/parity DLMM prices.
- Added a deterministic offline validator that mirrors the contract's integer rounding directions and can run without RPC, database, signer, or user data.
- Resolved reference deployment provenance fail-closed: no reference address, implementation, proxy, or admin role is required or accepted as a ZKBLAST behavioral baseline. Only fresh environment-bound ZKBLAST manifests and receipts are authoritative.

Validation:

- `pnpm check:protocol:vectors` passed all six vectors.
- Targeted Prettier validation and `git diff --check` passed.
- The validator initially exposed an 11-wei incorrect expected fee; the fixture was corrected to the contract's actual round-up behavior before completion.

Owner action required:

- None for this slice. The public repository license remains a release decision and is tracked separately from the completed technical provenance gate.

## 2026-10-18 — Slice 03 mainnet database isolation complete

Status: Slice 03 is now **100%** (`11/11`); the current explicit roadmap is approximately **94%** (`132/141`). The denominator is recalculated from every atomic checkbox in the current roadmap, correcting the stale `137`-task denominator used by earlier entries.

- Applied all 14 checksum-tracked migrations to the previously blank `zkblast_mainnet` schema in the approved shared Supabase project.
- Verified 20 backend-only tables, row-level security, role restrictions, and environment-qualified references after migration.
- Preserved strict environment isolation: no testnet seed, pool, user, transaction, or protocol row was copied into mainnet.
- Released the transaction reconciliation and network-boundary changes to the existing testnet Railway API, indexer, and web services. Mainnet services remain intentionally disabled until the launch gates are complete.

Validation:

- Mainnet environment security, migration-isolation, and mainnet-seed-prohibition checks passed.
- Mainnet migration and live schema verification completed successfully.
- API deployment `ce6a52ea-59d2-4de1-bd49-cfee870bede3`, indexer deployment `b8312797-cb0d-4c7b-8d37-8855aaeb3f67`, and web deployment `ddb0ac41-11b6-4d36-bfbd-9beffec5340b` all reached `SUCCESS`.
- Live smoke checks returned API health `200`, public config `testnet/46630`, unauthenticated operations access `401`, and web root `200 text/html`. The public API response contained no Supabase URL/key, RPC URL/key, signer key, or operations token.

Owner action required:

- No database credential or schema action is required.
- Before any mainnet contract deployment or mainnet service activation, provide production governance multisig and proxy-admin/timelock addresses, complete the independent audit, approve the recovery rehearsal, and approve the final deployment manifest.

## 2026-10-18 — Slice 03 idempotent transaction reconciliation complete

Status: Slice 03 is now **91%** (`10/11`); only the approval-gated mainnet schema provisioning/migration remains. The expanded roadmap is approximately **96%** (`131/137`).

- Added strict `TransactionReceipt` normalization for only `success` or `reverted` status and unsigned-decimal gas fields.
- Reconciled every canonical receipt into the environment-qualified `transactions` table using `(chain_id, transaction_hash)` as the idempotency key. Successful receipts become `confirmed`; reverted receipts become `reverted`; block number, gas used, and effective gas price are canonical receipt values.
- Preserved transaction ownership and client-request identity during reconciliation instead of replacing application-submitted rows.
- Extended reorg handling atomically: anonymous on-chain observations from orphaned blocks are removed, while user/client transactions are returned to `submitted` with orphaned block/gas fields cleared before canonical replay.
- Added the same deterministic reconciliation behavior to the in-memory repository so replay/reorg behavior is directly testable without repeated live-chain builds.

Validation:

- Indexer tests passed `8/8`, including duplicate block ingestion, canonical rewind/replay, success/revert normalization, invalid gas rejection, receipt replay idempotency, and orphan removal.
- Indexer typecheck and lint passed with zero warnings.
- No migration was required because both environment schemas already define the constrained transaction table and primary key used by reconciliation.
- No Railway deployment, contract transaction, database migration, or mainnet write was performed.

Owner action required:

- No environment value or immediate action is required for this completed task.
- The updated indexer must be included in the next explicitly approved Railway release before live services use reconciliation.
- Slice 03 can reach 100% only after explicit approval to provision and migrate the blank `zkblast_mainnet` schema; that write remains intentionally blocked.

## 2026-10-18 — Slice 02 scoped operations authorization complete

Status: Slice 02 is now **100%** (`16/16`); the expanded roadmap is approximately **95%** (`130/137`).

- Protected `/v1/protocol/operations/health` with a server-to-server bearer token while preserving public, rate-limited `/health`, `/ready`, `/v1/config`, and sanitized protocol metrics.
- Required at least 32 characters at API startup and used constant-time token comparison. Missing or incorrect credentials receive only `OPERATIONS_AUTH_REQUIRED`; operational accounting, route, pool, and receipt details are not returned.
- Added `OPERATIONS_API_TOKEN` to both environment templates and the private-value leak scanner.
- Added an idempotent local setup command that creates unique cryptographically random testnet and mainnet tokens, writes ignored environment files atomically with mode `0600`, and never prints token values.
- Kept the token out of all `NEXT_PUBLIC_*` variables. Browser code neither receives nor needs operations access.

Validation:

- API tests passed `23/23`, including missing-token, incorrect-token, and valid-token cases.
- API typecheck and lint passed with zero warnings.
- Environment public/private boundary scan passed after local testnet/mainnet token generation.
- No Railway deployment, database migration, contract transaction, or mainnet write was performed.

Owner action required:

- When configuring Railway, add a different `OPERATIONS_API_TOKEN` secret to `api-testnet` and `api-mainnet`. Do not add it to either web service.
- Configure the private monitoring client for each environment to send `Authorization: Bearer <matching-token>`. Railway's basic health check should continue using public `/health` and does not need the token.
- Railway deployment remains approval-gated; the local values were prepared but were not uploaded.

## 2026-10-18 — Parallel testnet/mainnet Railway boundary

Status: the parallel-environment task is complete; Slice 02 remains blocked only by future admin-endpoint authorization. The expanded roadmap is approximately **94%** (`129/137`).

- Kept the browser environment allowlist at `NEXT_PUBLIC_API_URL` only. Each web service selects its environment by calling its paired API `/v1/config`; Supabase, RPC, signer, and manifest values never enter the browser.
- Added fail-closed invariants at shared config, API response, and web ingestion boundaries: testnet accepts only chain `46630`, and mainnet accepts only chain `4663`.
- A cross-wired web/API pair is rejected before wallet login, signature, approval, or transaction preparation.
- Removed the unused static testnet/simulated network data module so the API response is the single runtime source of network truth.
- Documented six parallel Railway services (`web`, `api`, and `indexer` for each environment), separate CORS origins, schemas, manifests, and deployment authorization.

Validation:

- Config tests passed `4/4`, including both valid environment boundaries and crossover rejection.
- API tests passed `22/22`; API typecheck passed.
- Web tests passed `11/11`, including API-selected testnet/mainnet configurations and pre-wallet crossover rejection; web typecheck and lint passed.
- No Railway deployment, database migration, contract transaction, or mainnet write was performed.

Owner action required:

- No environment value is required for local implementation. When creating Railway services, set each web service's sole public variable `NEXT_PUBLIC_API_URL` to its matching API URL and set each API's `WEB_ORIGIN` to its matching web origin.
- Do not point the mainnet web at the testnet API or reuse one API/indexer process for both schemas. The new runtime checks reject chain crossover, but separate processes are still required.
- Railway deployment remains approval-gated.

## 2026-10-18 — Mainnet provider reuse with preserved isolation

Status: Slice 16 remains `1/5` checklist tasks and approximately **35% implementation progress**; overall roadmap remains approximately **94%** (`128/136`). Mainnet readiness improved from `3/8` to `4/8`, but launch remains blocked.

- Added an idempotent local configuration workflow that reuses the existing Alchemy account credential, Supabase project, and deployer wallet without printing their values.
- Derived the Robinhood Chain mainnet Alchemy HTTP/WSS hosts from the validated testnet hosts, then required both transports to return chain `4663` before writing `.env.mainnet` atomically with mode `0600`.
- Reused the Supabase project while preserving the mandatory `zkblast_mainnet` schema boundary. A read-only inspection confirmed that the schema does not yet exist, so no mainnet data is currently mixed with testnet.
- Populated canonical mainnet WETH/USDG execution addresses and the server-only reference RPC. Governance and upgrader values remain intentionally empty because mainnet requires separate multisig and timelock contracts, not the testnet EOAs.

Validation:

- Mainnet environment validation passed.
- HTTP and WebSocket network validation passed for chain `4663`.
- Browser public/private environment boundary validation passed.
- Mainnet readiness now passes environment, chain, schema selection, and runbooks (`4/8`). Configuration remains blocked only by `GOVERNANCE_MULTISIG_ADDRESS` and `PROXY_ADMIN_ADDRESS`; manifest, independent audit, and recovery rehearsal are also still pending.
- No database migration, contract transaction, mainnet deployment, or Railway release was performed.

Owner action required:

- Create or select the mainnet governance multisig and a separate timelock contract, then add their addresses to `.env.mainnet` as `GOVERNANCE_MULTISIG_ADDRESS` and `PROXY_ADMIN_ADDRESS`.
- Explicitly approve creation/migration of the blank `zkblast_mainnet` schema before any mainnet database write. Sharing the Supabase project reduces operational isolation, so backup and role/RLS verification remain mandatory.
- Independent audits and recovery rehearsal are still required before mainnet deployment approval.

## 2026-10-18 — Slice 16 fail-closed mainnet readiness foundation

Status: Slice 16 is **20%** (`1/5`) and intentionally blocked from launch; the expanded roadmap is approximately **94%** (`128/136`). ZKBLAST is not yet ready for mainnet.

- Added a single fail-closed `check:mainnet:readiness` command that reports only gate names and missing variable names, never secret values.
- The checker requires chain `4663`, schema `zkblast_mainnet`, complete server-only configuration, mandatory runbooks, an identity-bound mainnet manifest, independent audit approval with zero unresolved critical/high findings, and passed recovery-rehearsal evidence.
- Added deployment, migration, database, incident-response, and release runbooks with explicit multisig/timelock, source verification, backup, rollback, key-rotation, monitoring, and capped smoke-test requirements.
- Kept audit and rehearsal evidence in already ignored `audit-artifacts/` and `evidence/` paths. A roadmap percentage, build, or testnet approval cannot bypass them.

Validation:

- The readiness command completed fail-closed and reported `3/8` gates passing: environment, isolated mainnet schema, and mandatory runbooks.
- Chain, configuration, mainnet manifest, independent audit, and recovery rehearsal remain blocked. No mainnet RPC transaction, database connection, migration, deployment, or Railway release was performed.

Owner action required:

- Commission independent contract and circuit audits. After remediation, place the signed private approval record at `audit-artifacts/mainnet/approval.json` using the schema documented by the readiness checker.
- Create the mainnet multisig and separate timelock; provide their addresses in `.env.mainnet`, with an on-chain timelock delay of at least `172800` seconds.
- Provision an isolated mainnet Supabase project and complete only the blank variables in `.env.mainnet`; do not copy testnet credentials or data.
- Fund the dedicated mainnet deployer only after the audited release commit and addresses are frozen.
- Explicitly approve the recovery rehearsal before it is run. Contract deployment, database migration, smoke transactions, and Railway deployment each still require separate approval.

## 2026-10-18 — Maximum funded testnet Stock Token pools active

Status: Slice 19 remains approximately **98%** implementation-complete and is now `7/8` checklist tasks; the expanded roadmap is approximately **94%** (`127/135`). All faucet Stock Tokens currently available to the governance wallet are active.

- Added TSLA to the chain-bound testnet mapping and validated its testnet bytecode, symbol, decimals, and nonzero supply on chain `46630`.
- Added a strict reference bootstrap for temporary official-catalog outages: the matching chain `4663` token must independently pass bytecode, symbol, decimals, supply, and RPC-chain validation before any database row is written.
- Added automatic bootstrap-ID reconciliation so the next successful official catalog sync adopts the issuer ID without changing the database market identity or creating a duplicate.
- Created and funded the fifth DAMM pool, `TSLA/USDG`, then completed a real quote and swap through the deployed ZKBLAST router.
- Re-ran token mapping, pair-candidate synchronization, and route discovery. The scanner matched all five funded pools: AMD, AMZN, NFLX, PLTR, and TSLA.
- Raised the bounded Stock Token sync limit from 100 to 500, added isolated stock/Pons sync modes, and added bounded retries so one unavailable upstream does not force unrelated ingestion work.

Validation:

- Indexer TypeScript checking and lint passed with zero warnings.
- Testnet mapper completed `mapped=5` at block `138141709`.
- Pair synchronization processed `104` validated reference markets and `205` pair candidates.
- Route discovery completed `scanned=10`, `matched=5` at block `138142031`.
- The public deployment artifact records five distinct pool addresses and six successful transaction stages per market (`createPool`, base/quote approvals, liquidity, swap approval, and E2E swap), including receipt gas and fee evidence.
- The official Stock Token API was unavailable from the local runner during this work; no unvalidated API payload was persisted. The on-chain dual-chain validation path was used for TSLA and is explicitly marked for later issuer-ID reconciliation.

Owner action required:

- No environment value is required and no Railway deployment was performed.
- To increase beyond five Stock Token pools, claim or transfer additional supported testnet faucet tokens and testnet USDG to governance address `0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9`. Each current pool uses `0.01` base token and `2` USDG for its initial liquidity.
- To activate WETH pairs, also fund that same governance address with testnet WETH; its WETH balance is currently zero.
- A Railway release remains a separate action and requires explicit approval.

## 2026-10-18 — Slice 12 testnet exit gate complete

Status: **100%** (`4/4` implementation tasks and the testnet exit gate complete)

- Pinned TACEO Poseidon2 Solidity v0.3.0 at commit `4c599a08a45cd465a153d724425cee331c010df1` and proved contract/circuit parity against the frozen Circom v1 Merkle vector.
- Deployed and source-verified `Poseidon2FieldHasher`, upgradeable `ShieldedStateRegistry`, and upgradeable `ZKBlastVault` on Robinhood Chain Testnet.
- Authorized the vault, allowlisted the reviewed ZKTB testnet asset at the fixed `1 ZKTB` denomination, and completed an exact-allowance deposit E2E.
- Confirmed the public commitment event, deterministic root, registry root acceptance, leaf index `0`, receipt gas, transaction fee, and deployed runtime bytecode through the manifest audit.
- Created an AES-256-GCM/PBKDF2 encrypted recovery artifact locally; the plaintext note, nonce, passphrase, RPC credentials, and database credentials were not written to public artifacts or logs.
- Added and applied the testnet-only event-kind constraint migration, then backfilled three validated `commitment`/`root` events into `zkblast_testnet` without advancing or corrupting the continuous indexer checkpoint.
- Published manifest-backed vault configuration through the API and activated the real deposit/backup/restore interface on the Railway web deployment.

Progress measurement:

- Slice 12 implementation: **100%** (`4/4`).
- Slice 12 exit gate: **100%**.
- Current explicit roadmap checklist: **92%** (`97/106` atomic tasks complete); remaining tasks belong to withdrawal, shielded LP research/implementation, shielded swap research, and mainnet readiness.

Validation:

- Solidity vault and Poseidon2 suites: **5/5 passed**.
- API: **17/17 passed**; indexer: **6/6 passed**; web: **9/9 passed**.
- API, indexer, web, config, and contract-script TypeScript checks passed.
- API/indexer/web production builds passed; Railway deployments `325a0f54-c292-4640-bae7-66b82082595a`, `ed766f46-6953-4ccb-bc00-e86e333de047`, and `4c5e701b-df03-4496-a706-b0ab58b06d33` succeeded.
- Public browser inspection confirmed the live `/shielded` page receives the testnet vault, tree version, and fixed-denomination ZKTB asset only through `/v1/config`.

Owner action required:

- Copy `deployments/testnet/shielded-vault.private.json` to an encrypted offline location, verify the copy opens, and keep its passphrase separate. This ignored local file is the recovery evidence for the funded acceptance note and must never be committed or uploaded.
- Manually test `/shielded` with the intended browser wallet: connect on chain `46630`, generate a fresh note, choose a new passphrase of at least 12 characters, download the backup, store it separately, acknowledge the warning, and deposit exactly `1 ZKTB`.
- After manual testing, remove `DEPLOYER_PRIVATE_KEY`, `GOVERNANCE_PRIVATE_KEY`, and `UPGRADER_PRIVATE_KEY` from the active local `.env.testnet` copy and keep them in the preferred offline secret manager until Slice 13 deployment is explicitly approved.

## 2026-10-18 — Slice 12 browser note and wallet deposit flow

Status: implementation complete; testnet deployment exit gate intentionally pending approval

- Added a browser Web Worker backed by the frozen Poseidon2 BN254 vector-generator WASM, with a preparation check that must match the published commitment, root, and nullifier vector.
- Added cryptographically random secret/nonce generation and a versioned note domain bound to environment, chain ID, vault address, tree version, asset address, and raw amount.
- Replaced the legacy v0 backup format with AES-256-GCM plus PBKDF2-SHA256 at 600,000 iterations; backup metadata is authenticated and cross-network/cross-vault restore is rejected.
- Added ciphertext-only local storage scoped by environment, chain ID, and vault address. Plaintext secret and nonce are never stored in browser storage.
- Added a reusable deposit flow requiring an encrypted backup and an explicit irreversible-loss acknowledgement before submission.
- Added wallet execution for network switching, allowance inspection, nonzero allowance reset, exact approval, commitment deposit, receipt confirmation, event commitment validation, and leaf-index capture.

Progress measurement:

- Slice 12 implementation checklist: **100%** (`4/4` tasks complete).
- Slice 12 exit gate: **75%**; local contract, circuit, indexer, and web requirements pass, while authorized testnet deployment and deposit E2E remain pending.
- Overall explicit development checklist: **80%** (`55/69` atomic tasks complete).

Validation:

- Browser note circuit matched the frozen v1 Poseidon2 vector.
- Web tests: **9/9 passed**.
- Web TypeScript check passed.
- No Railway or testnet deployment was performed.

Owner action required:

- None for continued local development. A separate explicit approval will be requested before deploying the vault/state-registry changes and performing a funded testnet deposit E2E.

## 2026-10-18 — Slice 12 shielded deposit contract foundation

Status: contract and indexer foundation complete; browser note creation remains

- Added upgradeable `ZKBlastVault` deposit custody with an asset/denomination allowlist, exact allowance requirement, received-balance delta validation, pause control, duplicate-commitment rejection, incremental tree insertion, and root registration.
- Added public commitment events containing only depositor, asset, amount, commitment, leaf index, root, and tree version.
- Added vault and shielded-state-registry ABIs to the shared generated ABI package.
- Added commitment/root classification to the indexer and a hard persistence boundary rejecting secret, nonce, witness, Merkle path, passphrase, and private-key payload fields.
- Added explicit fee-on-transfer rejection coverage; rebasing assets remain prohibited by the governance-reviewed allowlist policy.

Progress measurement:

- Slice 12: **75%** (`3/4` roadmap tasks complete).
- Overall explicit development checklist: **79%** (`54/69` atomic tasks complete).

Validation:

- Focused vault suite: **4/4 passed**.
- Indexer suite: **6/6 passed**.
- ABI and indexer TypeScript checks passed.
- Solidity formatting check passed.

Owner action required:

- None. No Railway or testnet deployment was performed. Deployment will only be proposed after the browser note/backup flow and deposit transaction integration are complete.

## 2026-10-18 — Supplied UI fidelity restoration

Status: completed locally; Railway deployment is in progress

- Restored the complete landing composition from `docs/zkblast.zip`: Hero with both rails, ticker, terminal overview, markets, lanes, DLMM bins, note journey, disclosure, roadmap, contract modules, and final CTA.
- Retained the real wallet session, username, user trade history, swap execution, pool, position, analytics, and shielded-availability integrations.
- Replaced the visible operational fixtures in the pool rail, event stream, ticker, market board, and DLMM bin panel with validated testnet API/indexer data or explicit empty states.
- Preserved SVG/Lucide icons and reusable UI primitives; no emoji icon was introduced.

Progress measurement:

- Supplied UI fidelity restoration: **100%** (`2/2` roadmap tasks complete).
- Web experience refresh slice: **100%**.
- Overall explicit development checklist: **78%** (`51/66` atomic tasks complete); mainnet and shielded-vault slices remain pending.

Validation:

- `@zkblast/web` production build passed against `.env.testnet`.
- Local browser preview rendered the complete supplied section order and navigation.
- Railway web deployment: `ea6cc601-4674-4d3b-9dc7-6f43378106f1`.

Owner action required:

- After Railway reports success, hard-refresh the public web URL once to discard any browser-cached Next.js chunks, then compare the landing page with `docs/zkblast.zip`.

## 2026-10-17 — Router, quoter, and position manager integration surface

Status: completed for the Slice 04 integration surface

- Added a stateless quoter for DAMM exact-input quotes and bounded DLMM multi-bin quotes, including final-bin and traversal reporting.
- Added an upgradeable, registry-validated swap router for DAMM and DLMM exact-input routes.
- Added strict token funding and force-approval handling, with pool allowances cleared after every successful route.
- Added an upgradeable position manager with user ownership, transfer, DAMM/DLMM creation, liquidity increases, partial/full decreases, automatic close cleanup, bin binding, and registry validation.
- Added explicit registered-pool state to the upgradeable registry instead of relying on nonzero hash assumptions.
- Added integration tests proving quote/execution parity, routed recipient balances, approval cleanup, DAMM/DLMM position lifecycle, and rejection of unregistered pools.
- Integration tests exposed and fixed a proxy-storage initialization issue in the reentrancy guard; the guard now safely accepts zero-initialized proxy storage while rejecting entered state.

Progress measurement:

- Slice 04 Public AMM contract core: **63%** (`5/8` atomic tasks complete).
- Overall explicit development checklist: **77%** (`49/64` atomic tasks complete).
- Full UI/demo layer remains frozen at **100%** while protocol development continues.

Validation:

- Solidity 0.8.26 compilation passed.
- Contract suites: **28/28 tests passed**.
- Solidity formatting, repository formatting, environment-boundary scan, and legacy-brand scan passed.

Owner action required:

- None.

## 2026-10-17 — DLMM bin execution vertical

Status: completed

- Added an independent DLMM execution pool with bounded bin IDs, configurable bin step, per-bin token reserves, per-bin total shares, and per-user shares.
- Added per-bin initial/proportional liquidity and withdrawal with locked minimum liquidity and minimum-output protections.
- Added directional fixed-price exact-input execution using deterministic fixed-point bin prices.
- Added bounded cross-bin traversal, empty-bin skipping, active-bin updates, and atomic traversal-limit failure.
- Added LP fee retention, separately accounted protocol fees, configurable recipient/share, and fee collection that does not alter bin reserves.
- Added deadline, recipient, slippage, pause, recovery-withdrawal, strict-token-transfer, and reentrancy boundaries.
- Updated deterministic factory deployment and address prediction for executable DLMM pools.
- Removed the obsolete identity-only pool placeholder so the factory can create only executable DAMM or DLMM implementations.
- Added regression coverage for bin liquidity lifecycle, same-bin swaps, multi-bin traversal, empty-bin skipping, atomic traversal reversion, fee separation/collection, pause recovery, and CREATE2 prediction.

Progress measurement:

- Slice 04 Public AMM contract core: **50%** (`4/8` atomic tasks complete).
- Overall explicit development checklist: **75%** (`48/64` atomic tasks complete).
- Full UI/demo layer remains frozen at **100%** while protocol development continues.

Validation:

- Solidity 0.8.26 compilation passed.
- Contract suites: **23/23 tests passed**.
- Solidity formatting, repository formatting, environment-boundary scan, and legacy-brand scan passed.

Owner action required:

- None.

## 2026-10-17 — DAMM pool execution vertical

Status: completed; DLMM execution remains separate

- Added strict ERC-20 transfer helpers that support standard/no-return tokens and reject fee-on-transfer balance mismatches.
- Added a reusable reentrancy guard and liquidity math for square-root initialization and proportional share issuance.
- Implemented an independently named constant-product DAMM pool with locked minimum liquidity, non-transferable internal LP shares, add/remove liquidity, and exact-input swaps.
- Added LP fee retention and separately tracked protocol-fee balances so protocol collection does not alter LP reserves.
- Added administrator-controlled fee recipient/share configuration and emergency pause controls; withdrawals and protocol-fee collection remain available while paused.
- Added recipient, deadline, minimum-output, minimum-share, and minimum-withdrawal protections.
- Updated the factory to deploy DAMM execution pools deterministically while retaining the separate DLMM identity placeholder.
- Added mock-token and regression coverage for initial/proportional liquidity, removal, invariant preservation, fee accrual/collection, pause recovery, slippage, deadline, and factory integration.

Progress measurement:

- Slice 04 Public AMM contract core: **38%** (`3/8` atomic tasks complete).
- Overall explicit development checklist: **73%** (`47/64` atomic tasks complete).
- Full UI/demo layer remains frozen at **100%** while protocol development continues.

Validation:

- Solidity 0.8.26 compilation passed.
- Contract suites: **17/17 tests passed**.
- Solidity formatting, repository formatting, environment-boundary scan, and legacy-brand scan passed.

Owner action required:

- None.

## 2026-10-17 — Upgradeable pool registry and deterministic factory

Status: completed for the Slice 04 registry/factory foundation

- Added an independent ERC-1967 proxy and UUPS upgrade implementation with proxy-context validation, implementation-code validation, `proxiableUUID` compatibility validation, authorized upgrades, and optional migration calls.
- Disabled initializers in both registry and factory implementations while allowing atomic proxy initialization.
- Added separate default-admin, upgrader, and factory roles using ZKBLAST-specific role domains.
- Added normalized pool keys so reversed token input resolves to one canonical pool identity.
- Added upgradeable pool registry with forward/reverse lookup, duplicate protection, role-restricted registration, and pool counting.
- Added upgradeable pool factory with DAMM/DLMM configuration validation and deterministic CREATE2 pool deployment.
- Added immutable public pool identity containing factory, normalized tokens, model, fee tier, and DLMM bin step.
- Added regression tests for implementation initializer lock, deterministic address prediction, DAMM normalization, DLMM bin-step state, duplicate prevention, authorized state-preserving upgrade, and unauthorized upgrade rejection.

Progress measurement:

- Slice 04 Public AMM contract core: **29%** (`2/7` atomic tasks complete).
- Full UI/demo layer remains frozen at **100%** while protocol development continues.
- Overall explicit development checklist: **73%** (`46/63` atomic tasks complete).

Validation:

- Solidity 0.8.26 compilation passed.
- Contract suites: **11/11 tests passed**.
- Solidity formatting, repository formatting, environment-boundary scan, and legacy-brand scan passed.

Owner action required:

- None.

## 2026-10-17 — Public AMM math kernel

Status: completed; factory, pool, router, and proxy layers remain in Slice 04

- Added an independent 512-bit `mulDiv` implementation with explicit floor and ceiling rounding.
- Added constant-product DAMM exact-input and exact-output quote math with fee rounding against the trader and invariant protection.
- Added discrete-bin DLMM price math with bounded bin steps, bounded bin IDs, fixed-point exponentiation, reciprocal pricing, and directional quoting.
- Added executable Solidity regression vectors covering full-precision arithmetic, fees, output/input rounding, invariant preservation, zero-bin parity, monotonicity, and reciprocal rounding.
- Kept credit, buyback, Telegram, automation, previous deployment addresses, and legacy product identity out of the new contract source.

Validation:

- Solidity formatting passed.
- Solidity 0.8.26 compilation passed.
- Contract regression suite passes after correcting the independently calculated full-precision expected vector.

Owner action required:

- None.

## 2026-10-17 — Reusable web-component and clean-code refactor

Status: completed

- Reduced the application orchestrator from approximately 1,480 lines to a focused routing, account-session, and shell module of under 300 lines.
- Extracted landing, swap, pools, portfolio, explorer, developers, and documentation into independent feature components.
- Extracted reusable `AppLink`, `Badge`, `Panel`, `MetricStrip`, and `PoolTable` components.
- Extracted the browser API client, shared application types, address formatter, and currency formatter.
- Consolidated related profile and trade state into one account state object.
- Added `check:web:architecture` to reject TypeScript/TSX modules over 350 lines, duplicated shared primitives inside feature modules, and direct `fetch` usage in the application orchestrator.
- Preserved the existing UI, routing, JSON fixture boundary, and secure wallet-session behavior.

Validation:

- Web typecheck and lint passed after the refactor.
- Web architecture, environment-boundary, legacy-brand, and formatting checks passed.

Owner action required:

- None.

## 2026-10-17 — Complete product UI and demo-flow map

Status: completed for the full local UI layer; contract-backed actions remain a separate development task

- Adapted the complete owner-authorized Asian Network visual system into an independent ZKBLAST experience.
- Added functional routes for landing, swap, pools, pool detail, portfolio, explorer, developers, and documentation.
- Added swap inputs, token reversal, calculated demo output, quote detail, route visualization, wallet gate, and transaction-review modal.
- Added DLMM/DAMM pool directory, liquidity distributions, pool metrics, range/deposit position builder, account positions, and verified trade-history surfaces.
- Added protocol activity explorer, developer endpoint reference, architecture map, integration examples, execution lifecycle documentation, deployment-manifest example, roadmap, and safety boundary.
- Moved all demonstration tokens, pools, metrics, transactions, positions, FAQ, API reference, and roadmap content to `apps/web/src/data/*.json`.
- Kept live wallet authentication, session restoration, username management, and user-scoped history connected to the API.
- Labelled fixture-derived values as `DEMO` and prevented the review flow from pretending that undeployed contracts can submit a transaction.
- No Asian Network brand, copy, endpoint, contract address, credential, environment value, or user data was included.

Progress measurement:

- Full UI design/routes/demo-flow layer: **100%** for the requested visual phase.
- Slice 07 roadmap checklist: **86%** (`6/7`); only real contract-backed swap submission/recovery remains.
- Slice 08 UI checklist: **50%** (`2/4`); contract/indexer integration and accounting validation remain.

Validation:

- Web typecheck passed.
- Web lint passed.
- Browser environment-boundary and legacy-brand scans passed.
- Desktop browser QA passed for the landing, trading, pool-detail, and route-navigation surfaces.
- The responsive layout includes dedicated tablet and mobile breakpoints.

Owner action required:

- None for the UI phase.
- Later, real swap/liquidity submission requires verified testnet deployment manifests; do not enter any contract address into browser code manually.

## 2026-10-17 — Asian Network visual-system adaptation

Status: completed for the current ZKBLAST landing and identity slice

- Rebuilt the ZKBLAST web shell to match the owner-authorized Asian Network industrial visual language.
- Added the same structural character: sticky segmented header, compact mono navigation, three-column hero shell, protocol registry rack, deep central bezel, technical coordinates, instrument ticks, CTA rack, activity terminal, and framed footer.
- Retained the existing ZKBLAST wallet login, network guard, secure session restoration, username management, and per-user trade history.
- Replaced all product identity and copy with ZKBLAST-specific liquidity language.
- Did not copy Asian Network endpoints, contracts, environment values, market data, addresses, credentials, or product names.
- Kept the implementation local-only under the Sites workflow; nothing was published.

Progress measurement:

- Slice 07 identity/web foundation remains **60%** (`3/5`); the remaining tasks are the real Public AMM transaction flow, not additional visual scaffolding.
- Explicit cross-slice roadmap checklist remains **78%** (`38/49`).

Validation:

- Web typecheck and lint passed.
- Legacy-brand scan passed.
- Browser environment boundary scan passed.
- Local API and web preview returned successfully.
- Desktop browser QA confirmed the adapted layout and reported no console warnings or errors after load.

Owner action required:

- None for this UI adaptation.

## 2026-10-17 — Protocol and indexer database baseline

Status: completed and applied to testnet

- Added isolated testnet/mainnet migrations for assets, pools, positions, swaps, fee events, ingestion checkpoints, and transaction lifecycle records.
- Added chain/address and transaction/log idempotency constraints.
- Added canonical-event markers to support reorg reconciliation.
- Added precision-safe `numeric(78,0)` storage for token, liquidity, fee, gas, and gas-price values.
- Added user, pool, status, and time indexes for API and indexer query paths.
- Added testnet/mainnet schema isolation, RLS, public-role revocation, and backend-only privileges.
- Applied `202610170003_protocol_indexer_baseline.sql` to live testnet.
- Expanded live verification from six identity tables to all thirteen application tables.

Progress measurement:

- Slice 03: **73%** (`8/11` tracked tasks complete).
- Explicit cross-slice roadmap checklist: **78%** (`38/49` complete).

Remaining blockers to a truthful 100%:

- ZKBLAST contracts, ABIs, and testnet deployment manifests do not exist yet, so swap execution and event ingestion cannot be completed against real addresses.
- Mainnet Supabase provisioning is intentionally deferred until the mainnet release phase.
- Hosted CI protection requires the Git hosting provider/repository to be selected.
- Deployment signer-role and explorer verification require deployed contracts and roles.

Owner action required:

- No action for this database task. To close the hosted-CI task later, provide or select the Git hosting repository. Do not provide signing keys through chat.

## 2026-10-17 — Wallet login and user dashboard web integration

Status: completed for the identity vertical slice

- Added environment-driven wallet connection and chain switching without hardcoded network IDs.
- Connected the browser only to `NEXT_PUBLIC_API_URL`; Supabase, PostgreSQL, RPC, and service credentials remain server-only.
- Added API challenge retrieval, wallet message signing, signature verification submission, and credentialed cookie requests.
- Added automatic secure-session restoration, logout, profile display, username editing, and per-user trade-history presentation.
- Added a responsive independent ZKBLAST interface with accessible labels, disabled states, empty states, and missing-wallet guidance.
- Enabled fixed-origin credentialed CORS for `GET`, `POST`, and `PATCH` while retaining the API origin allowlist.
- Added a dedicated `@zkblast/config/web-public` export so the browser bundle does not traverse server/deployment configuration modules.
- Followed the Sites local-only workflow: no hosted Site was created or published.

Progress measurement:

- Slice 07 identity/web foundation: **60%** (`3/5` tracked tasks complete).
- Explicit cross-slice roadmap checklist: **76%** (`37/49` complete). This measures defined foundation tasks, not final mainnet readiness.

Validation:

- Web and API typechecks passed.
- Web and API lint passed with zero warnings.
- Six focused API tests passed, including credentialed CORS/session coverage.
- Local testnet API and web previews started successfully.
- Browser QA confirmed network labeling, connect-wallet state, missing-wallet guidance, and successful API configuration loading.
- Environment security, brand, migration isolation, and formatting checks remain green.

Owner action required:

- None for this slice. A browser wallet is only needed when you want to manually exercise the real signature flow.

## 2026-10-16 — Authenticated profile and trade-history API

Status: completed

- Added server-side session resolution from the `zkblast_session` cookie hash.
- Added `POST /v1/auth/logout`, including database revocation and immediate cookie clearing.
- Added authenticated `GET /v1/me` for profile, login metadata, and verified wallets.
- Added authenticated `PATCH /v1/me/username` with strict validation and a sanitized username-conflict response.
- Added authenticated `GET /v1/me/trades` with cursor pagination and a hard 100-row limit.
- Ensured every user-specific query obtains `userId` from the server session; no endpoint accepts a browser-supplied user ID.
- Added active-account, expiration, and revocation checks while resolving sessions.
- Reused one bounded PostgreSQL connection pool for authentication and identity operations.

Progress measurement:

- Slice 03: **64%** (`7/11` tracked tasks complete).
- Explicit cross-slice roadmap checklist: **77%** (`34/44` complete). This is a foundation-checklist percentage, not final mainnet readiness.

Validation:

- API typecheck and source lint passed.
- Six focused API tests passed.
- Tests cover missing-session rejection, session-owned profile/username/trade access, wallet signature login, secure cookies, logout revocation, public configuration filtering, and sanitized errors.

Owner action required:

- None for this slice.

## 2026-10-16 — Wallet authentication vertical slice

Status: challenge endpoint and atomic session creation completed; authenticated profile/trade endpoints remain next

- Added canonical wallet sign-in messages bound to the configured web origin, chain ID, nonce, issue time, and expiration time.
- Added cryptographically random one-time nonces and SHA-256 hashes for nonce, exact message, and session token persistence.
- Added EVM signature verification using `viem`.
- Added `POST /v1/auth/challenge` and `POST /v1/auth/verify`.
- Added an `HttpOnly`, `Secure`, `SameSite=Strict` session cookie; the raw session token is never returned in JSON.
- Added an atomic PostgreSQL login function that consumes the challenge once, creates or resolves the user/wallet, updates login metadata, writes the audit record, and creates the session.
- Applied `202610160002_atomic_wallet_login.sql` to live testnet without deleting existing data.
- Kept the custom schema out of Supabase REST exposure by moving authentication persistence to a direct backend-only PostgreSQL connection.
- Added Turborepo environment pass-through declarations so server-only values reach backend processes without becoming browser variables.
- Completed a live challenge smoke test against the testnet database with HTTP `201`.

Progress measurement:

- Slice 03: **64%** (`7/11` tracked tasks complete).
- Explicit cross-slice roadmap checklist: **77%** (`33/43` complete). This is the current foundation-checklist percentage, not the percentage of the final mainnet release.

Validation:

- API typecheck and lint passed.
- Three focused API tests passed, including a real locally signed EVM message and secure-cookie assertions.
- Migration isolation and formatting checks passed.
- Live API-to-testnet-database challenge creation passed.

Owner action required:

- None for this slice.

## 2026-10-16 — Live Supabase testnet migration

Status: completed and verified

- Validated the direct PostgreSQL URL without logging its host, username, password, database name, or full value.
- Added a reusable environment-aware database migrator with an explicit testnet/mainnet schema boundary.
- Added a migration checksum ledger so an already-applied migration cannot be silently changed.
- Added a PostgreSQL advisory lock to prevent concurrent migration runs.
- Applied each new migration transactionally.
- Applied `202610160001_identity_and_trade_history.sql` to the live `zkblast_testnet` schema.
- Verified all six identity tables exist with RLS enabled.
- Verified `anon` and `authenticated` have no direct read/write privileges on identity tables.
- Verified `service_role` has the required backend privileges.
- Verified there are no cross-environment constraint references.

Progress measurement:

- Slice 03: **60%** (`6/10` tracked tasks complete).
- Explicit cross-slice roadmap checklist: **76%** (`31/41` complete). This remains a foundation-checklist percentage, not the percentage of the final mainnet product.

Owner action required:

- None for this completed migration step. Keep the direct database URL and service-role credential only in the ignored local environment file.

## 2026-10-16 — Identity repository and progress measurement

Status: completed locally; live database integration remains blocked only by the missing direct testnet database URL

- Added a backend-only, schema-bound identity repository.
- Added profile reads containing username, account state, login metadata, and verified wallets.
- Added username claiming with strict `3–24` character validation and database-enforced case-insensitive uniqueness.
- Added paginated per-user trade-history reads with a hard maximum of 100 records per request.
- Added runtime validation for every database response so malformed rows fail closed instead of leaking unvalidated data into API responses.
- Added normalized lowercase EVM wallet-address handling.
- Added focused validation tests without running a full monorepo build.

Progress measurement:

- Slice 03: **50%** (`4/8` tracked tasks complete).
- Cross-slice checklist currently represented by explicit roadmap checkboxes: **74%** (`29/39` complete). This percentage covers the currently checkbox-defined foundation work, not the entire final protocol release.

Validation:

- Database package typecheck passed.
- Three focused identity validation tests passed.
- Database source and test lint passed with zero warnings.

Owner action still required:

- Fill `SUPABASE_DIRECT_DATABASE_URL` in the ignored `.env.testnet` file. Until it is present, migrations cannot be safely applied and live repository/API integration cannot be verified.

## 2026-10-16 — User identity and trade-history database foundation

Status: migration design and isolation validation completed; remote application awaits the private testnet database connection URL

- Added separate generated migrations for the `zkblast_testnet` and `zkblast_mainnet` schemas.
- Added `users` with optional unique usernames, account status, and first/last login counters.
- Added verified multi-wallet ownership with one primary wallet per user.
- Added one-time wallet login challenges and server-managed sessions that persist only token hashes.
- Added login-attempt audit records with optional hashed network and user-agent fingerprints; raw IP addresses and raw user-agent values are not stored.
- Added per-user trade history linked to verified wallets, transaction hashes, log indexes, raw token amounts, status, block metadata, and client request IDs.
- Enabled RLS on every identity table, revoked browser-facing database roles, and granted access only to the backend service role.
- Added a migration isolation validator that rejects testnet/mainnet cross-schema references.
- Added `SUPABASE_DIRECT_DATABASE_URL` as a private, server-only environment variable; it is never exposed to the web application.

Validation:

- Identity migration generation completed for both environments.
- Static schema-isolation validation passed.
- Legacy-brand scan passed across generated SQL.

Owner action required:

- Fill `SUPABASE_DIRECT_DATABASE_URL` directly in the ignored `.env.testnet` file using the testnet Supabase direct Postgres connection URL. Do not paste this credential into chat or commit it to Git.
- No mainnet credential is needed during testnet development.

## 2026-10-16 — Alchemy WebSocket and secure API foundation

Status: completed

- Derived the testnet WSS endpoint from the configured Alchemy HTTPS endpoint without logging the endpoint or API key.
- Stored the ignored testnet env file with owner-only file mode.
- Validated both HTTP and WebSocket JSON-RPC against chain ID `46630`.
- Added API server-only configuration validation, fixed-origin CORS, request rate limiting, Helmet security headers, a 32 KiB JSON limit, sanitized errors, and no framework disclosure header.
- Added `/health` and schema-filtered `/v1/config` endpoints.
- `/v1/config` returns only environment, chain ID, chain name, and explorer URL; it cannot return Supabase, RPC, signer, or deployment credentials.
- Added focused API tests for config allowlisting, CORS, header suppression, and sanitized 404 responses.

Validation:

- HTTP/WSS network validation passed for chain `46630`.
- API typecheck and lint passed.
- Two focused API security tests passed.
- Environment boundary and completeness checks remain green.

## 2026-10-16 — Testnet public metadata completed

Status: completed

- Added Robinhood Chain Testnet chain ID `46630` and official network name.
- Added the official testnet Blockscout explorer URL.
- Added local ZKBLAST API URL `http://127.0.0.1:3001` as the sole browser environment value.
- Environment completeness and public/private boundary validation pass.
- Live RPC `eth_chainId` returned the expected chain ID without logging the configured RPC URL or credentials.
- A local DNS/TLS filter presented an unrelated certificate for the explorer hostname; TLS verification was not disabled or bypassed. The explorer value remains sourced from official Robinhood documentation, and deployment-time explorer API verification remains open.

## 2026-10-16 — API-only browser environment

Status: completed

- `NEXT_PUBLIC_API_URL` is now the only browser environment variable permitted by code and security validation.
- Supabase URL/keys/schema, RPC URLs, chain configuration, WalletConnect configuration, deployment manifests, signer values, and governance values were removed from the browser allowlist.
- Legacy `NEXT_PUBLIC_*` entries were removed from ignored local testnet/mainnet env files without printing their values.
- Tracked env examples now document only the API URL as browser-visible.
- The web configuration schema fails closed if the API URL is absent or invalid.

Validation:

- Environment public/private boundary scan passed.
- Web and configuration typechecks passed.
- Focused web lint passed.

## 2026-10-16 — Web environment exposure hardening

Status: completed implementation; testnet configuration remains incomplete

- Network-specific commands now explicitly load `.env.testnet` or `.env.mainnet`.
- Browser configuration reads only an enumerated `NEXT_PUBLIC_*` allowlist.
- Private/server variables are not passed to browser components.
- The environment security scanner rejects secret-like public variable names and detects private values copied into public variables without printing those values.
- Web responses disable the framework disclosure header and add content-type, frame, referrer, permissions, and cross-origin opener protections.
- Git confirms only redacted env examples are trackable; actual env files remain ignored.

Validation:

- Public/private environment boundary scan passed.
- Web and config typechecks passed.
- Web lint and legacy-brand scan passed.
- Testnet completeness validation correctly failed because `CHAIN_ID`, `CHAIN_NAME`, and `BLOCK_EXPLORER_URL` remain empty.

## 2026-10-16 — Sensitive-file policy and Git initialization

Status: completed

- The complete `docs/` directory is ignored because it will contain local reports and evidence.
- Environment files, secrets, credentials, signing material, Supabase local state, Foundry broadcasts, circuit proofs/witnesses/keys, reports, audit artifacts, backups, and private deployment receipts are ignored.
- Redacted `.env.testnet.example` and `.env.mainnet.example` remain trackable.
- Git was initialized only inside `zkblast-project/` after ignore rules were applied.
- `git check-ignore` confirmed the sensitive paths are excluded, and `git status` contains no local env or documentation files.

## 2026-10-16 — Reference ownership confirmed

Status: completed

- The owner confirmed that they developed and own the complete reference protocol.
- Internal adaptation for ZKBLAST is authorized.
- The provenance blocker in Slice 00 is marked complete.
- Third-party dependency license review and the public ZKBLAST repository license remain separate release tasks.
- Previous branding, deployments, credentials, databases, user data, addresses, and operational identity remain prohibited from reuse.

## 2026-10-16 — Reference audit documentation

Status: inventory complete; Slice 00 remains open for license, explorer, and regression evidence

Delivered:

- Repository and module inventory at the inspected reference commit.
- Initial code-provenance and reuse decisions.
- Actual ZKBLAST monorepo architecture and dependency-boundary document.
- Gap analysis covering foundation, public protocol, ZK/security, and operations.
- Checkbox status tracking in the development roadmap.

Findings:

- Reference deployment manifests mix current, legacy, feature, pool, and operational records in flat JSON.
- Reference indexer contains useful reorg concepts but requires protocol-qualified schemas and modular projectors.
- The reference package declares MIT, but no root license file was discovered; source remains reference-only until provenance is confirmed.
- Reference addresses and roles have not been accepted or imported.

Validation:

- Legacy-brand scan passed.
- Workspace formatting was normalized.
- TypeScript validation remains green after documentation/scaffold formatting.

## 2026-10-16 — Project directory boundary

Status: completed

- The ZKBLAST workspace root is now a container directory only.
- The complete monorepo was moved into `zkblast-project/`.
- Apps, packages, environments, deployments, Supabase files, scripts, dependencies, and documentation now share that single project root.
- Git remains uninitialized.

## 2026-10-16 — Monorepo foundation

Status: completed

Delivered:

- One pnpm/Turborepo workspace for all ZKBLAST components.
- Application foundations for web, API, indexer, and keeper.
- Shared packages for ABI, runtime configuration, SDK, UI, database access, and observability.
- Reserved Foundry contract and ZK circuit workspaces with explicit security gates.
- Explicit `.env.testnet` and `.env.mainnet` configuration model.
- Environment-specific deployment-manifest schema with proxy, implementation, transaction, block, gas, fee, compiler, bytecode hash, and verification fields.
- Dedicated Supabase schema enforcement for `zkblast_testnet` and `zkblast_mainnet`.
- Legacy-brand scanner and secret/private artifact ignore rules.
- Initial web shell and API health endpoint.

Validation:

- Typecheck passed for all ten TypeScript packages/apps that expose a typecheck task.
- Focused lint passed for web, API, indexer, and keeper.
- Legacy-brand scan passed.
- Confirmed that no Git repository is present.

Not executed:

- Full production build and E2E tests; no product vertical slice exists yet.
- Foundry build/tests; contract implementation and dependency selection are gated by audit and upgradeability approval.
- Circuit build/tests; the proof system is intentionally not selected before Slice 10.

Owner input needed:

- Complete the required testnet values in `.env.testnet` before services connect to external infrastructure.
- Approve or amend `docs/ADR-001-UPGRADEABILITY.md` before proxy contracts are implemented.

## 2026-10-17 — Slice 04 deployment tooling and manifest v2

Status: tooling complete; live testnet deployment remains pending

Delivered:

- Added a deterministic deployment flow for the upgradeable PoolRegistry, PoolFactory, SwapRouter, and PositionManager plus the non-proxy PoolQuoter.
- Added atomic proxy initialization, factory-role configuration, explicit testnet/mainnet manifest paths, and an additional confirmation gate for mainnet.
- Added manifest schema v2 with proxy and implementation addresses, initializer data, all transaction receipts, gas, effective gas price, total fee, deployment blocks, bytecode hashes, role assignments, compiler settings, and verification status.
- Added an on-chain manifest verifier for chain identity, deployed code, runtime bytecode hash, ERC-1967 implementation slots, transaction success/gas, integration addresses, and totals.
- Added artifact readiness validation and environment-specific root commands for deployment and verification.
- Added a credential-redacting, read-only deployment preflight for RPC chain identity, deployer balance, separated governance/upgrader addresses, and account type inspection.
- Kept private keys, RPC credentials, Supabase credentials, and local receipts outside the browser bundle and ignored private artifact paths.

Validation:

- Contract deployment scripts type-check passed.
- Shared deployment manifest config type-check passed.
- Six required deployment artifacts passed bytecode and initializer checks.
- The live testnet RPC returned the configured chain successfully, but the derived deployer `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B` currently has zero native balance, so deployment was safely stopped before any transaction.
- Public/private environment boundary scan passed.
- Legacy-brand scan passed.
- No blockchain transaction was submitted during this task.

Progress:

- Active Slice 04: 67% (`6/9` tasks).
- Overall development roadmap: 77% (`50/65` tracked tasks).

Owner action needed before the live testnet deployment:

- Confirm that `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B` is the intended testnet deployer, then fund it with enough native testnet gas token for ten transactions (four implementations, four initialized proxies, one quoter, and one registry role configuration). The current on-chain balance is zero.
- Confirm that `GOVERNANCE_MULTISIG_ADDRESS` is the final testnet governance address and `PROXY_ADMIN_ADDRESS` is the final dedicated upgrader address; do not use a personal wallet unless that is an intentional temporary testnet policy.
- Rotate the current Alchemy API key before continuing. The first sandbox-blocked preflight exposed its RPC endpoint in local command diagnostics; the preflight now converts transport failures to a redacted error and no browser bundle contains this value.
- Do not paste any private key or Supabase credential into chat. Update only `.env.testnet` locally if a value needs correction.
- After those three checks, explicitly authorize the live testnet deployment because it sends transactions and spends testnet gas. The generated `deployments/testnet/manifest.json` will then be verified before its roadmap task is marked complete.

## 2026-10-17 — Slice 04 live testnet deployment

Status: deployed and verified on-chain; explorer source publication awaits explicit approval

Delivered:

- Preflight passed for Robinhood Chain Testnet chain ID `46630` with a funded deployer.
- Fixed the root pnpm wrapper so it invokes the workspace deployment script instead of pnpm's reserved deploy command.
- Detected that post-deployment factory-role assignment was incompatible with immediate governance ownership, stopped without writing a false manifest, and corrected registry initialization to grant the predicted factory atomically.
- Added per-transaction private recovery journals and recovered all nine receipts from the superseded partial deployment into an ignored private evidence file.
- Re-ran the complete Solidity suite after the initialization change: `28/28` tests passed.
- Successfully deployed four UUPS implementations, four initialized ERC-1967 proxies, and one non-proxy quoter in nine transactions.
- Generated and schema-validated `deployments/testnet/manifest.json`.
- Verified all five contracts, nine receipts, gas values, runtime bytecode hashes, four implementation slots, integration addresses, and the factory role directly against testnet.
- Final deployment used `9,841,132` gas and `98,411,320,000,000 wei` total transaction fees.
- Public/private environment and legacy-brand scans remain clean.

Canonical testnet integration addresses:

- PoolRegistry proxy: `0xD3E491a0B9c9cfED288EA4d7a0827c0B248EfF50`
- PoolFactory proxy: `0x4FC2dA2feb00a905DFAF39a7e402943250e0221E`
- SwapRouter proxy: `0xF06276C3C6900268B3d6940b05ee75c9320B46c2`
- PositionManager proxy: `0xeA8488b911b6b51ca0a172e59BDD26ce1be1075f`
- PoolQuoter: `0xb0C2EF188B57E720D44a318F495d87C6e95dcE69`

Progress:

- Active Slice 04: 70% (`7/10` tasks).
- Overall development roadmap: 77% (`51/66` tracked tasks).

Owner action needed:

- Explicitly approve or reject uploading the ZKBLAST Solidity source and compiler metadata to the official Robinhood Chain Testnet Blockscout explorer. This is external source publication; it was not performed implicitly.
- Governance and upgrader are currently separate EOAs. This is accepted only for testnet; mainnet remains blocked until multisig/timelock acceptance checks pass.

## 2026-10-17 — Testnet explorer source verification

Status: completed

Delivered:

- Received explicit owner authorization to publish ZKBLAST Solidity source and compiler metadata to the official Robinhood Chain Testnet Blockscout explorer.
- Published and verified PoolRegistry, PoolFactory, SwapRouter, PositionManager, and PoolQuoter implementations/non-proxy contracts.
- Confirmed all four ERC-1967 proxy addresses are recognized as verified by Blockscout using their reconstructed constructor arguments.
- Updated the canonical testnet manifest from `pending` to `verified` and added implementation/proxy explorer URLs.
- Extended the manifest verifier to query Blockscout and reject a `verified` manifest entry when explorer source is unavailable.

Validation:

- Manifest schema and environment binding passed.
- On-chain receipt, gas, runtime bytecode, implementation-slot, integration-address, and factory-role verification passed.
- Blockscout source verification passed for all nine deployed addresses.
- Mainnet source and deployment were not submitted.

Progress:

- Active Slice 04: 80% (`8/10` tasks).
- Overall development roadmap: 79% (`52/66` tracked tasks).

Owner action needed:

- None for testnet explorer verification.
- Before mainnet, governance and upgrader EOAs must be replaced with approved multisig/timelock addresses.

## 2026-10-17 — Storage layout and governance acceptance

Status: completed; PoolFactory testnet implementation upgrade prepared

Delivered:

- Enabled Foundry storage-layout artifacts and committed a baseline for PoolRegistry, PoolFactory, SwapRouter, and PositionManager.
- Added an automated compatibility check that rejects removed/reordered fields, slot or offset changes, and storage type encoding/size changes while allowing safe append-only evolution.
- Added governance acceptance tests proving the admin cannot bypass the dedicated upgrader, the upgrader cannot self-grant admin, and the factory role remains isolated.
- Added mainnet preflight enforcement requiring deployed governance/timelock contracts and a configurable minimum `getMinDelay()` value; testnet remains EOA-compatible.
- Removed all Solidity lint findings, including explicit overflow protection before protocol-fee narrowing and zero-address validation for pool administrators.
- Added a two-signer testnet upgrade workflow that deploys a new implementation with the deployer and executes the UUPS upgrade with the dedicated upgrader, while recording both transactions and previous/new implementations in manifest history.

Validation:

- `31/31` Solidity tests passed.
- Solidity compilation completed without code lint warnings.
- Storage compatibility passed for all four upgradeable contracts.
- Contract tooling and deployment schema type-check passed.
- Environment security and legacy-brand scans passed.

Progress:

- Active Slice 04: 90% (`9/10` tasks).
- Overall development roadmap: 80% (`53/66` tracked tasks).

Owner action needed:

- Add `UPGRADER_PRIVATE_KEY` to `.env.testnet` locally. It must derive to `0x48e7BcFE8F469FBc72E6BcEf0D0cE70d51FFBbed`. Never send the key through chat.
- The upgrader currently has `0.011056422722732` native testnet token, so no additional funding is required for the prepared PoolFactory upgrade.
- After the key is present, the new PoolFactory implementation can be deployed, upgraded through the stable proxy, verified on Blockscout, and recorded in the manifest.

## 2026-10-17 — PoolFactory upgrade and Slice 04 completion

Status: completed

Delivered:

- Validated that `UPGRADER_PRIVATE_KEY` matches the dedicated testnet upgrader without exposing the key.
- Deployed PoolFactory implementation `0xB3C158cd339B9589A307ba8A75C77A177F540737` and upgraded the stable proxy `0x4FC2dA2feb00a905DFAF39a7e402943250e0221E`.
- Recorded the previous/new implementations, implementation deployment receipt, proxy upgrade receipt, gas, fees, blocks, and hashes in manifest upgrade history.
- Verified the implementation slot, new runtime bytecode hash, transaction totals, and upgraded implementation source on Blockscout.
- Extended manifest verification to validate upgrade-history continuity, every upgrade receipt, aggregate transaction count, aggregate gas, and aggregate fees.
- Added explicit regression coverage for malicious-token callback reentrancy, unauthorized DAMM/DLMM administration, and DLMM slippage/deadline rejection.
- Completed the Slice 04 behavior matrix without changing any public proxy address.

Validation:

- `34/34` Solidity tests passed across seven suites.
- Solidity compilation completed without code lint findings.
- Storage-layout compatibility passed for all four upgradeable contracts.
- Manifest schema, receipt, implementation-slot, bytecode, role, gas/fee total, and Blockscout source checks passed.
- Environment security and legacy-brand scans passed.

Progress:

- Slice 04: 100% (`10/10` tasks).
- Overall development roadmap: 82% (`54/66` tracked tasks).

Owner action needed:

- None for Slice 04 or the PoolFactory testnet upgrade.
- Mainnet remains untouched and blocked behind multisig/timelock readiness.
## 2026-10-17 — Slice 05 completed

Status: completed

- Generated and exported eight protocol ABIs directly from Foundry artifacts with a deterministic stale-output check.
- Added a typed SDK surface for manifest-derived addresses, quotes, slippage, approvals, DAMM/DLMM swaps, managed liquidity positions, transfers, and protocol-fee claims.
- Centralized token unit conversion, basis-point rounding, deadlines, and normalized transaction error codes.
- Added a verified-venue adapter boundary that requires chain, source-verification, and audit metadata; no unverified external venue implementation was introduced.
- Verified one DAMM and one DLMM quote-to-swap/liquidity vertical flow: 4/4 SDK tests pass, ABI and SDK typechecks pass, and the SDK production build succeeds.

Progress:

- Slice 05: 100% (`4/4` tasks).
- Overall development roadmap: 83% (`58/70` tracked tasks).

Owner action needed:

- None for Slice 05.

## 2026-10-17 — Slice 06 completed

Status: completed

- Added an executable manifest-driven Viem indexer with bounded batches, environment finality policy, idempotent event identity, canonical block tracking, checkpoints, and atomic PostgreSQL writes.
- Added deterministic reorg recovery that finds a common ancestor, removes orphaned state, and replays canonical blocks.
- Classified pool, swap, position, liquidity, fee, and receipt event domains behind a dedicated chain-reader boundary.
- Added rate-limited pool, swap, position, readiness, and RPC-lag endpoints backed by server-only PostgreSQL access.
- Added recursive structured-log redaction for Supabase, RPC, database, authorization, password, private-key, and API-key fields.
- Applied and verified the reorg-safe migration only in `zkblast_testnet`; mainnet was not contacted.
- Completed a live testnet smoke sync at checkpoint block `137232470` without exposing RPC or database credentials.

Validation:

- Indexer tests: `2/2` passed, including idempotent duplicate ingestion and deterministic rewind/replay.
- API tests: `9/9` passed, including rate limiting, readiness/lag, and recursive secret redaction.
- Indexer and API typechecks, lint, and production builds passed.
- Database isolation, environment security, and legacy-brand scans passed.

Progress:

- Slice 06: 100% (`4/4` tasks).
- Overall development roadmap: 84% (`62/74` tracked tasks).

Owner action needed:

- None for Slice 06; indexer tuning variables have safe defaults and are documented in both environment examples.

## 2026-10-17 — Slice 07 swap implementation completed

Status: implementation complete; live testnet acceptance awaits the first launch pool

- Replaced the demo-only swap panel with environment-bound indexed pool discovery and server-prepared DAMM/DLMM quotes.
- Added server-side registered-pool validation, exact raw-amount handling, slippage minimums, deadline enforcement, and encoded approval/swap calldata from generated ZKBLAST ABIs.
- Added wallet execution states for wrong-network switching, approval, swap submission, receipt confirmation, user rejection, revert, and pending/replaced recovery guidance.
- Kept RPC URL, deployment manifest, ABI routing, Supabase configuration, and database credentials outside the browser bundle.
- Production web build, API build, `11/11` API tests, and `2/2` wallet-flow tests passed.

Progress:

- Slice 07 implementation tasks: 100% (`8/8`).
- Slice 07 acceptance gate: pending a real indexed/funded testnet pool for a live swap receipt.
- Overall development roadmap: 85% (`63/74` tracked tasks).

Owner action needed:

- Approve creation of dedicated ZKBLAST testnet token contracts, one launch pool, and seeded test liquidity if you want the live testnet swap E2E gate completed now. This creates persistent public testnet addresses and transactions, so it is intentionally not inferred from UI implementation authority.

## 2026-10-17 — Slice 07 live testnet acceptance completed

Status: completed

- Deployed two fixed-supply ZKBLAST testnet-only tokens and verified their source on Blockscout.
- Created and registered one 0.30% DAMM pool through the governance-authorized PoolFactory.
- Seeded `100,000` units per side, quoted a `100`-unit exact-input swap, and executed the approval/router swap successfully.
- Recorded eight receipts with transaction hashes, blocks, block hashes, gas, effective gas prices, and total fees in `deployments/testnet/market.json`.
- Registered both assets and the pool in `zkblast_testnet`, then backfilled seven canonical pool/liquidity/swap/receipt events.
- Confirmed the live read API returns the indexed pool and executable environment-bound quote/calldata.
- Independently re-read all receipts, bytecode, registry membership, pool reserves, aggregate gas/fees, and explorer source status.

Acceptance:

- Token ZKTB: `0x1DF949C7a8351cc5679403935d3c883Fa796F3F5`.
- Token ZKTA: `0xc56d156D535d31d236A6a3553161f969a6416e0a`.
- DAMM pool: `0xdBF680e69b0672D7659328Bf03014fF9E4218CE6`.
- Swap transaction: `0xf3153ac7be163ce929fb3c3225e1c168e12e688a4d95865ac838bf570427a449`.
- Transactions: `8/8` successful; aggregate gas `2,906,475`; aggregate fee `29,064,750,000,000 wei`.

Progress:

- Slice 07: 100% (`8/8` tasks and live testnet exit gate).
- Overall development roadmap: 85% (`63/74` tracked tasks).

Owner action needed:

- Remove `GOVERNANCE_PRIVATE_KEY` from `.env.testnet` after this acceptance run if no additional governance transaction is planned immediately; the file is ignored by Git, but minimizing stored privileged keys is safer.

## 2026-10-17 — Slice 08 liquidity and positions completed

Status: completed

- Added server-prepared DAMM/DLMM position creation, increase, decrease, transfer, and authorized protocol-fee claim flows.
- Added on-chain owner, pool-registration, token-pair, share-balance, and fee-recipient validation before executable calldata is returned.
- Connected the pools UI to indexed pools for live create/remove liquidity and fee-claim eligibility; connected the portfolio to indexed position data.
- Added an accounting API that reconciles token balances with reserves plus accrued protocol fees.
- Executed a live testnet position creation and partial removal, with complete transaction/gas evidence in `deployments/testnet/liquidity-acceptance.json`.
- Reconciled both pool token balances exactly and retained `4,995,004,995,004,995,005` shares in position `#1`.

Validation:

- Live acceptance transactions: `4/4` successful; gas `477,841`; total fee `4,778,410,000,000 wei`.
- API tests: `15/15`; web transaction tests: `3/3`.
- API, web, and contract script typechecks passed; testnet production web build passed.
- Architecture, private environment boundary, and legacy-brand scans passed.

Progress:

- Slice 08: 100% (`4/4` tasks and testnet exit gate).
- Overall development roadmap: 88% (`65/74` tracked tasks).

Owner action needed:

- No value needs to be added now. For security, remove `GOVERNANCE_PRIVATE_KEY` from `.env.testnet` unless you plan another governance operation soon. Keep `DEPLOYER_PRIVATE_KEY` only while additional testnet acceptance transactions are required. Both files remain ignored by Git.

## 2026-10-17 — Slice 09 testnet deployment and operations completed

Status: completed

- Confirmed the deterministic deployment workflow and independent testnet governance, upgrader, deployer, proxy, implementation, and integration addresses.
- Re-verified all deployment and upgrade receipts, gas totals, implementation slots, upgrade chain, runtime bytecode hashes, roles, integration mappings, and nine explorer source records.
- Added a reproducible deployment auditor that compares exact creation transaction input, implementation/proxy constructor arguments, initializer arguments, ABI hashes, metadata hashes, and current runtime bytecode.
- Recorded an explicit claim boundary: the deployed phase is Public AMM, contains no ZK circuit, and makes no shielded-transaction claim.
- Added server-side alert evaluation for RPC lag, stale indexer checkpoints, pool balance deviations, paused pools, and recent reverted/replaced/dropped transactions.
- Added environment-specific alert thresholds without exposing RPC or database configuration to the browser.
- Added read-only deployment reproduction and opt-in, non-custodial migration documentation. No legacy asset, approval, user, or data movement was performed.

Validation:

- Deployment manifest verification: five contracts and nine verified explorer addresses passed.
- Deployment audit: five contracts passed creation-input, constructor, initializer, ABI, metadata, and bytecode checks.
- Operations alert unit tests cover healthy and all-alert states.
- Contract scripts and API typechecks passed.

Progress:

- Slice 09: 100% (`5/5` tasks and reproducibility exit gate).
- Overall development roadmap: 95% (`70/74` tracked tasks).

Owner action needed:

- No new environment value is required; alert thresholds have safe defaults and are documented in both environment examples.
- Remove `GOVERNANCE_PRIVATE_KEY`, `UPGRADER_PRIVATE_KEY`, and `DEPLOYER_PRIVATE_KEY` from `.env.testnet` now if you are not immediately performing another privileged testnet operation. Read-only verification and monitoring do not require them.
- Before a public testnet launch, choose the always-on runtime where `@zkblast/indexer` and `@zkblast/api` will be deployed. The live monitoring smoke test correctly reported the locally stopped indexer as stale; a continuously running indexer is an operational deployment action, not an additional secret/value requirement.

## 2026-10-17 — Slice 10 ZK architecture complete

Status: 100% (`4/4` tasks); overall development roadmap: 100% (`74/74` tracked tasks)

- Selected Circom 2 plus snarkjs/Groth16 after the initially preferred Noir/UltraHonk verifier exceeded the frozen gas gate.
- Froze canonical BN254 encoding, Poseidon2 domain separation, note/nullifier formulas, depth-32 tree, 256-root history, replay controls, versioning, and verifier-key provenance.
- Froze the exact ordered 13-field withdrawal public-input schema in machine-readable JSON.
- Added reviewed threat model and privacy guarantees that explicitly exclude amount, asset, recipient, timing, network, and Public AMM privacy.
- Added benchmark thresholds and installed both browser-capable candidate toolchains as circuit-package development dependencies.
- Completed ten verified desktop proofs per candidate. Noir median/p95 were 338.5/852 ms; Circom median/p95 were 759.5/1,146 ms.
- Verified the selected Circom proof in a real Chrome Web Worker in 589.21 ms with 45,111,530 bytes measured after proof.
- Verified both generated Solidity verifiers against valid proofs on local Anvil. Noir used 2,937,726 gas and failed the 1,500,000 gate; Circom used 41,077 gas and passed.

Validation:

- Circuit architecture/schema check passed.
- Circuit benchmark acceptance passed for the selected candidate.
- Both local EVM proof calls returned `true`; the browser proof also returned `true`.
- Environment-boundary, brand-isolation, and diff checks passed.

Next:

- Start Slice 11 with the versioned production Circom circuit, verifier adapter, deterministic positive/negative vectors, and governed phase-2 ceremony plan.

Owner action needed:

- No environment value is required now. Before a production or public testnet verifier deployment in Slice 11, approve the phase-2 ceremony policy and contributors; never reuse the deterministic benchmark proving key.

## 2026-10-17 — Slice 11 verifier and state foundation

Status: 100% implementation (`4/4` tasks); expanded overall roadmap: 100% (`78/78` tracked tasks). Slice exit gate remains pending ceremony approval and testnet verification.

- Added an immutable versioned verifier registry. Existing `(circuitId, version)` records cannot be overwritten; governance may only deactivate a compromised version or register a new one.
- Added an upgradeable shielded-state registry with vault authorization, consumer authorization, 256-root ring buffers, duplicate-root-safe reference counts, and tree-version-scoped spent nullifiers.
- Added a withdrawal verifier adapter bound to the frozen 13-field public-input order, canonical BN254 field values, chain, vault, circuit/tree version, root, nullifier, asset, amount, recipient, relayer, fee, deadline, and withdrawal action.
- Added a depth-32 incremental commitment-tree library with deterministic leaf ordering, field-element checks, cached zero/subtree values, and a pluggable field-hasher boundary so the contract can use the exact audited Poseidon2 implementation selected by the production circuit.
- Added rejection coverage for altered proofs, wrong action/domain, wrong chain, unknown roots, expired roots, repeated nullifiers, inactive verifiers, and attempted replacement of an existing verifier version.
- Added the Circom withdrawal v1 circuit with exactly 13 public and 67 private inputs, 32-level membership, note/nullifier recomputation, canonical bit bounds, non-zero amount, fee bound, and leaf-index/path binding.
- Pinned and vendored the MIT-licensed TACEO Poseidon2 BN254 implementation and constants, preserving source hashes and audit lineage.
- Added one deterministic valid witness and six rejected adversarial vectors covering root, nullifier, action domain, direction bit, leaf index, and fee bounds.
- Added an artifact manifest with compiler/prover versions, 32,148 constraints, source/vendor/R1CS/WASM hashes, and an explicit non-deployable ceremony state.

Validation:

- Targeted `ShieldedFoundationTest`: 5/5 passed.
- Withdrawal v1 compilation: 32,148 constraints, 13 public inputs, 67 private inputs.
- Circuit vectors: 1/1 positive accepted and 6/6 negative rejected.
- Solidity 0.8.26 compilation passed.
- No network deployment or privileged environment value was used.

Remaining:

- Approve and conduct the circuit-specific phase-2 ceremony, publish its transcript, and register the resulting verifier/key hashes.
- Generate the Solidity Poseidon2 field hasher from the identical pinned parameters and cross-check it against every deterministic Merkle vector.
- Deploy the verifier and adapters to testnet, then pass the reproducible on-chain proof exit gate before marking the Slice 11 heading `[x]`.

Owner action needed:

- None for the next local implementation step. Before phase-2/testnet deployment, approve the ceremony policy and contributor list; the deterministic benchmark key remains forbidden for deployment.

## 2026-10-17 — Slice 11 testnet exit gate complete

Status: 100% (`4/4` tasks plus local/testnet exit gate); expanded overall roadmap: 100% (`78/78` tracked tasks).

- Completed a testnet-only power-15 ceremony with two cryptographically random phase-2 entropy contributions executed in separate processes on the same device, followed by a public final beacon.
- Kept every raw entropy value only in process memory. No entropy was written to terminal output, documentation, deployment JSON, or repository files.
- Explicitly classified this ceremony as development/testnet-only. It does not provide independent-party trust and is forbidden for mainnet.
- Verified the final zkey against the frozen R1CS and prepared Powers of Tau, exported the verification key, generated a proof bound to chain ID `46630`, and verified it locally.
- Generated the withdraw-v1 Groth16 Solidity verifier plus the ZKBLAST protocol-interface adapter.
- Deployed `ZKBlastWithdrawVerifier` to Robinhood Chain Testnet at `0x2a4D288A6c92E55A631CB987d7Af79099933b596`.
- Verified the valid proof both by `eth_call` and by a successful testnet transaction, then published and verified the source on Blockscout.
- Recorded full deployment/proof transaction hashes, blocks, gas, fees, runtime bytecode hashes, circuit/key hashes, beacon data, and proof hashes in `deployments/testnet/withdraw-verifier.json`.

Validation:

- Final proving key SHA-256: `d043c702e676165a3490253ba66af1a9edb4b43cbf4461425d4f1024bd42dcba`.
- Verifier deployment transaction: `0x0cd8a0259c83d2b0b9944e94b9bfa71baca3bef3137672096a2a462fb96e2c35`, gas used `761359`.
- Valid-proof transaction: `0x3497bf21283678a7f08da70d5556c3bdcf261a6665d92212aca7da83046dca1a`, gas used `298985`.
- Deployed bytecode exactly matches the compiled runtime bytecode.
- Contract source verification status: Blockscout `Pass - Verified`.
- Slice 11 roadmap heading is now `[x]`.

Next:

- Start Slice 12 with the exact-parameter Solidity Poseidon2 field hasher cross-check, then the isolated shielded vault deposit vertical slice.
- Deploy the verifier registry/state registry/adapter together with the vault when its real address and authorization context exist; the direct testnet verifier exit gate is already complete.

Owner action needed:

- No environment value or immediate manual action is required for the next Slice 12 implementation step.
- Keep the testnet-only ceremony warning intact; do not copy this proving key or verifier to mainnet.
- Privileged keys are no longer needed for local Slice 12 implementation. For improved security, remove `DEPLOYER_PRIVATE_KEY`, `GOVERNANCE_PRIVATE_KEY`, and `UPGRADER_PRIVATE_KEY` from `.env.testnet` until the next explicitly approved testnet deployment.

## 2026-10-17 — Supplied ZKBLAST web experience integrated

Status: 100% (`6/6` UI-integration tasks); expanded tracked roadmap: 100% (`84/84` tasks through the web refresh).

- Adopted the complete supplied `docs/zkblast.zip` visual system for the landing page and the swap, pools, positions, shielded, analytics, and docs routes.
- Preserved a reusable structure across shell, UI primitives, charts, landing modules, swap, pools, account, and shielded components instead of producing page-local monoliths.
- Replaced every emoji/character-based icon occurrence with SVG/Lucide components or plain non-icon wording. A repository scan found no remaining prohibited icon characters in web TypeScript or CSS.
- Replaced the supplied fake wallet connector with the existing API challenge/signature login flow and environment-bound chain switch.
- Added session restoration, logout, username update, login-count display, and per-user trade-history display through the server-side API/Supabase boundary.
- Replaced the supplied simulated swap card with indexed testnet pools, server-verified quotes, exact approval and swap calldata, wallet execution, receipt polling, explorer links, and account-history refresh.
- Kept `NEXT_PUBLIC_API_URL` as the only browser environment input. RPC URLs, WebSocket RPC, Supabase URL, anon/service keys, direct database URL, schemas, deployer keys, and governance keys remain unavailable to browser bundles.
- Corrected the shielded-page status: the withdraw-v1 verifier is deployed and source-verified, while custody vault actions remain clearly labelled local simulations until Slice 12.

Validation:

- Web TypeScript type-check passed.
- Next.js production build passed with all 20 routes generated.
- Browser QA passed for the landing page and `/swap` route.
- Browser QA confirmed the API supplied Robinhood Chain Testnet and the indexed ZKTB/ZKTA DAMM pool to the live swap card.
- Environment security scan and prohibited icon-character scan passed.

Owner action needed:

- For manual testing, keep the API and web dev server running, open `http://127.0.0.1:3000`, connect an injected EVM wallet already configured for Robinhood Chain Testnet, sign the login challenge, then use `/swap` to request a quote and submit approval/swap transactions.
- No new environment value is required. If the wallet does not already know chain `46630`, add Robinhood Chain Testnet manually in the wallet; the web intentionally does not expose the private RPC URL needed for automatic chain registration.
- The `/shielded` controls must only be used as a UI preview until Slice 12 deploys the vault; they cannot move real assets in the current implementation.

## 2026-10-17 — Real testnet data migration complete

Status: 100% (`7/7` tasks); expanded tracked roadmap: 100% (`91/91` tasks through the real-data migration).

- Removed operational fixture datasets and the old demo-only route/components from the runtime web application.
- Rebuilt landing, pools, swap activity, analytics, and wallet positions around the environment-bound API and finalized testnet index.
- Added reusable loading, unavailable, and empty states. Missing records are never replaced with fabricated values.
- Disabled shielded deposits, withdrawals, local notes, proof progress, solvency figures, and anonymity figures until the real vault exists on-chain.
- Added authenticated-wallet position filtering at the API/database boundary.
- Added strict pre-persistence validation for chain identity, blocks, hashes, addresses, event shape, payload bounds, and checkpoint consistency.
- Applied the same validation to the continuous indexer repository and the testnet market backfill.
- Aligned testnet CORS with the manual-testing origin `http://localhost:3000`.

Validation:

- API, indexer, and web TypeScript checks passed.
- Web lint and environment-boundary scan passed.
- Indexer tests passed `5/5`, including rejection of chain and block-hash mismatches.
- Environment-aware Next.js production build passed for all 10 active routes.
- Browser QA displayed the real indexed `ZKTB/ZKTA` DAMM pool and its testnet contract address.
- The testnet API endpoints for pools, positions, and metrics returned HTTP 200.

Current testnet state:

- One validated pool is present in the database.
- No validated swap or position rows are currently present, so the UI correctly shows empty states.
- The indexer is running and catching up from its persisted checkpoint; the UI exposes its real lag instead of masking it.

Owner action needed:

- No new environment value is required.
- Keep the web, API, and indexer processes running while testing at `http://localhost:3000`.
- Generate a real testnet swap through `/swap`; after its block is finalized and indexed, refresh the page to verify the event appears. Do not expect a swap/position row before the indexer reaches that block.

## 2026-10-18 — Railway testnet deployment

Status: 100% for initial Railway deployment (`3/3` runtime services deployed); post-deployment indexer catch-up remains in progress.

- Linked the local monorepo to Railway project `practical-ambition`, environment `production`.
- Applied the previously staged service definitions without auto-deploying stale GitHub source.
- Created public Railway domains only for web and API; indexer remains private with no public domain.
- Transferred the minimum service-specific testnet variables through stdin. Secret values were never printed to commands, logs, or documentation.
- Did not upload deployer, governance, or upgrader private keys to any runtime service.
- Kept RPC and Supabase variables out of the web service; web has only `NEXT_PUBLIC_API_URL` plus Railway-provided metadata.
- Bundled internal `@zkblast/*` dependencies into API/indexer outputs for a stable monorepo runtime.
- Added Railway-aware API `PORT` and `0.0.0.0` binding while preserving loopback binding for local development.
- Deployed API, indexer, and web from the local workspace with `.gitignore` filtering.
- Did not deploy keeper because its current implementation is a library stub with no persistent job runner.

Deployment endpoints:

- Web: `https://zkblastweb-production.up.railway.app`
- API: `https://zkblastapi-production.up.railway.app`

Validation:

- API deployment status: `SUCCESS`; `/health` HTTP 200; `/v1/config` HTTP 200.
- Web deployment status: `SUCCESS`; `/` HTTP 200.
- Indexer deployment status: `SUCCESS`; runtime logs show advancing testnet checkpoints.
- Public pools and metrics endpoints returned HTTP 200.
- Browser QA confirmed the Railway web origin can read the API through CORS and displays the real indexed `ZKTB/ZKTA` pool.
- API/web domains target Railway runtime port 8080.

Owner action needed:

- No secret or environment value needs to be added now.
- Keep the Railway services running while the indexer catches up. Its lag is still material, so swaps and positions remain empty until their blocks are indexed.
- If a custom domain is desired later, provide the domain name and DNS provider access; the current Railway domains are already functional.

## 2026-10-18 — Slice 13 local withdrawal path complete

Status: 100% for Slice 13 (`4/4`: implementation, browser flow, adversarial validation, and testnet E2E complete); tracked roadmap remains approximately 92% (`100/109` atomic tasks).

- Connected `ZKBlastVault` to the versioned withdrawal verifier adapter with accepted-root validation and nullifier consumption before payout.
- Added exact sender/recipient balance-delta checks so fee-on-transfer or otherwise non-conforming tokens cannot produce a partial withdrawal.
- Kept the proxy storage layout append-only: `withdrawalAdapter` occupies new slot 73 after the original tree and mappings. Added the vault to the automated storage-layout baseline.
- Added root synchronization through the API using only public commitment events and the on-chain Poseidon2 hasher. The API verifies its reconstructed root against the vault and never receives note secrets or nonces.
- Added browser-only Groth16 witness/proof generation, local proof verification, strict public-signal comparison, wallet submission, receipt/event validation, and real progress/error UI.
- Replaced the legacy simulated withdrawal UI. No random nullifier, dummy withdrawal, or mock completion remains in the runtime flow.
- Generated the updated vault ABI and prepared the withdraw WASM, proving key, verification key, and bundled worker as static browser assets.

Validation:

- Vault deposit/withdraw suites: `9/9` passed.
- Shielded foundation regression suite: `5/5` passed.
- API tests: `17/17` passed; web tests: `9/9` passed.
- API/web type checks and lint passed.
- Environment-aware Next.js production build passed for all 10 routes.
- ABI generated-file check and five-contract storage-layout compatibility check passed.
- Read-only testnet root synchronization reproduced leaf `0`, a 32-level path, and on-chain root `0x1278e1af2d689ab4dd1b5bd032fa279ff868203d9cb3095865b939693b3901a9` at block `137773132`.

Testnet deployment:

- Preserved vault proxy address `0x3C87569210706b413101ad6a30E9E623e38d8051` and upgraded only its implementation to `0x33067dc6118E355bC7B415103Ad5E40C52C64D1E`.
- Deployed VerifierRegistry proxy `0x26cc247284966D24eF0D9DE03a59AE55Bae0c0f7`, implementation `0x766fcaE1BECEA363694F1955E79a5F9AfC1746eC`, and WithdrawalVerifierAdapter `0xB699ca9D4125CB35715Ba15199bE17131B09a564`.
- Registered the deployed withdraw-v1 verifier, authorized the adapter as nullifier consumer, and connected it to the upgraded vault.
- Successfully withdrew the acceptance note in transaction `0x8ad11279c5823e24090b040651b60561447f438837838a2d514613f82ac0b702` at block `137788528`.
- Confirmed the acceptance nullifier is spent, the recipient received the exact denomination, and the acceptance vault balance is zero.
- Deployment used 9 successful transactions, `4018155` gas, and `40181550000000` wei total fees.
- Published and verified the vault implementation, VerifierRegistry implementation/proxy metadata, and WithdrawalVerifierAdapter source/constructor metadata on Blockscout.
- Full post-deployment audit passed for 10 protocol contracts.
- Released API deployment `71cd6542-8a46-44e2-ba66-3a0c621f7da2` and web deployment `c925dc33-0c2a-4aac-899f-c08ac2b10a32` to Railway; both reached `SUCCESS`.
- Public Railway smoke tests passed for API health/config, 32-level root sync, shielded web route, and the 13,385,060-byte browser proving key.

Owner action needed:

- No environment value needs to be added.
- Manual testnet deposit and withdrawal can now be performed from `https://zkblastweb-production.up.railway.app/shielded`. Create a new note, download its encrypted backup, deposit exactly 1 ZKTB, restore/select the note, enter a recipient, and generate the browser proof.
- The original acceptance note is permanently spent and is marked as such in the ignored private recovery file; do not attempt to reuse it.
- For credential hygiene, remove `DEPLOYER_PRIVATE_KEY`, `GOVERNANCE_PRIVATE_KEY`, and `UPGRADER_PRIVATE_KEY` from the active `.env.testnet` file now and retain them only in an offline secret manager. They are not required by API, web, or indexer runtime services.

## 2026-10-18 — Slice 14 aggregate LP manager local implementation

Status: 80% for Slice 14 (`4/5`: design, implementation, invariants, and disclosure complete; independent review/meaningful-custody gate remains); tracked atomic roadmap remains approximately 92% (`104/113`).

- Added a non-upgradeable `ShieldedLPManager` bound immutably to one vault, one registered DAMM pool, and its exact two assets.
- Added least-privilege vault integration: only the configured vault can invest/divest, governance can only pause or emergency-exit back to that same vault, and a manager with live shares cannot be removed.
- Added per-asset note liabilities to the vault. Deposits increase liabilities, successful withdrawals decrease them, and aggregate LP movement never erases a user claim.
- Defined conservative accounted assets as liquid vault balance plus pool-share redemption rounded down. Each asset must independently cover its own liability; no oracle or cross-asset surplus can conceal a deficit.
- Required an explicit governance-funded, non-liability solvency reserve to absorb AMM minimum-liquidity and share-rounding loss. The first adversarial run correctly rejected investment without this reserve.
- Added aggregate invest/divest events, public manager shares, per-asset solvency views, exact transfer boundaries, pause behavior, and vault-only emergency recovery.
- Published the accounting model and launch gate in `docs/SHIELDED_LP_ACCOUNTING.md`, expanded the privacy/threat disclosures, and added the same boundary notice to the shielded UI.
- Generated updated vault and LP-manager ABIs.

Validation:

- Full Foundry suite passed `54/54` tests across 12 suites.
- LP-manager tests passed multi-asset conservation, multi-deposit liabilities, downward rounding, swap-driven yield/loss, proportional redemption, unauthorized access rejection, active-manager removal rejection, and emergency exit.
- Storage layout compatibility passed with new vault mappings appended after the deployed withdrawal-adapter slot.
- Contract, ABI, and web TypeScript checks passed; web lint passed.

Not deployed:

- The Slice 14 vault implementation and `ShieldedLPManager` remain local. No testnet contract, source publication, or Railway release was performed.
- The roadmap heading remains unchecked because independent review is an explicit exit gate before meaningful custody.

Owner action needed:

- No environment value is required.
- Before any Slice 14 deployment, arrange an independent review covering the vault liability migration, manager permissions, per-asset solvency model, reserve sizing, AMM share rounding, impermanent loss, emergency exit, and v1 circuit semantics.
- After review findings are accepted, explicitly approve a testnet-only deployment and choose the reviewed two-asset DAMM pool plus the governance-funded reserve amounts for each asset.

## 2026-10-18 — Slice 15 shielded-swap research gate

Status: 67% for Slice 15 (`2/3`: design comparison and threat analysis complete; proof of concept remains blocked on explicit design approval); tracked atomic roadmap is approximately 91% (`106/116`).

- Compared dedicated shielded pools, batched intents/net settlement, and private routing into the public DAMM.
- Rejected a dedicated shielded pool for the current roadmap because it introduces a second private accounting system, fragmented liquidity, substantially larger circuits, and difficult recovery semantics.
- Rejected private routing into the public DAMM as a private-swap claim because pair, direction, size, route, price impact, transaction timing, and settlement metadata remain public and highly correlatable.
- Selected batched intents only as the preferred research candidate. It is not approved for implementation and has no circuit, contract, or deployment authorization.
- Defined mandatory conservation, price-bound, atomicity, domain-separation, censorship-recovery, fee-bound, data-availability, oracle, measurable-anonymity, and interruption-safety properties.
- Analyzed MEV, public price discovery, oracle manipulation, solver/relayer behavior, fees and gas, recipient/timing leakage, and the difference between a plausible anonymity set and total historical deposits.
- Added mandatory experiments and an exact approval gate in `docs/ADR-003-SHIELDED-SWAP-RESEARCH.md`.
- Updated the product privacy guarantee and threat model to state clearly that ZKBLAST does not currently provide private swaps.

Validation:

- Documentation formatting, repository whitespace, environment-boundary scan, and legacy-brand scan passed.
- No contract, circuit, runtime application, database, environment, deployment manifest, or Railway service was changed for Slice 15.

Owner action needed:

- No environment value or deployment action is required.

## 2026-10-19 — Railway wallet-login compatibility fix

Status: implementation, verification, and Railway API deployment complete.

- Extended the authentication boundary to accept both canonical 65-byte Ethereum signatures and compact 64-byte EIP-2098 signatures.
- Normalized compact signatures to the canonical representation before wallet recovery, preserving the existing address and challenge verification.
- Configured the API to trust exactly one Railway reverse-proxy hop so rate limiting uses the client forwarding chain without triggering the Express proxy validation error seen in runtime logs.
- Added integration coverage for both signature representations; session tokens remain server-side in secure, HTTP-only cookies.

Validation:

- API TypeScript checking and lint passed.
- API integration tests passed `24/24`, including canonical and compact wallet login.
- Repository whitespace validation passed.

Owner action needed:

- Deployment `bab80aff-685c-472f-88c9-ec6ef7a8b5a6` reached `SUCCESS`; public health and sanitized config endpoints returned `200`, and startup logs reported the API ready on testnet chain `46630` without errors.
- No environment variable or secret change is required.
- Hard-refresh the web app, reconnect the wallet, approve the network switch if prompted, and sign the fresh ZKBLAST login message once. Report the response body from `/v1/auth/verify` only if it still fails; never send the wallet signature or any private key.

## 2026-10-19 — Verified testnet market-logo curation

Status: testnet research, curation, database application, and public API verification complete.

- Reconciled all 101 catalogued Stock Tokens against Robinhood's official `/rhj/assets` response, active status, chain-4663 deployment, contract address, and CDN URL.
- Fetched and validated every referenced file using HTTPS status, MIME type, size bounds, and PNG signature before approving it. Robinhood currently returns the same official product mark for these assets rather than distinct issuer logos; the UI therefore does not claim those marks are issuer artwork.
- Matched PONS and LINK artwork by exact contract address to their respective source sites, added strict address-to-source allowlisting, remote image validation, atomic database updates, and curation audit records.
- Kept the pons `TEST` token logo missing because no contract-matched authoritative artwork was found. No guessed or same-symbol logo was stored.
- Applied changes only to `zkblast_testnet`. The live API now exposes approved logo URLs for `103/104` markets; mainnet was not modified.

Validation:

- Stock logo reconciliation passed `101/101` with no metadata or file failures.
- Indexer type checking and lint passed; repository whitespace validation passed.
- Public API verification returned `103` approved visible logos and exactly one honest missing-logo fallback (`TEST`).

Owner action needed:

- No environment variable or deployment is required; the existing web reads these database-backed URLs through the API immediately.
- Hard-refresh the market page. Distinct issuer logos for Stock Tokens require a licensed/free-trial logo provider or individually curated issuer brand sources because Robinhood's official endpoint currently serves one shared product mark.

## 2026-10-19 — Overlapping base/quote market identity

Status: implementation, testnet data curation, and local validation complete; API/web Railway deployment is pending explicit approval.

- Rejected the shared Robinhood product mark as a market logo for Stock Tokens instead of presenting it as issuer artwork.
- Curated distinct issuer artwork for the five active testnet markets: AMD, AMZN, NFLX, PLTR, and TSLA. Each mapping remains bound to the validated Stock Token contract address.
- Stored the official Global Dollar artwork URL in database metadata as the USDG quote identity.
- Added `logoUrl` to database-derived pair candidates so the browser does not infer a quote logo from a symbol or hardcoded contract.
- Replaced the single square market image with a reusable pair badge: circular base and quote marks overlap, each has an independent SVG fallback, and failed remote images degrade safely without emoji.
- Kept unverified issuer marks rejected rather than showing a generic or guessed brand.

Validation:

- Database curation applied atomically to `zkblast_testnet`; mainnet was not modified.
- Indexer, API, and web strict TypeScript and lint checks passed.
- API integration tests passed `24/24`; web tests passed `11/11`.
- The public API already exposes the five curated base logos. The new quote-logo field and overlapping UI require deployment of the changed API and web services.

Owner action needed:

- Approve one Railway deployment each for API and web. No environment variable, secret, contract deployment, or database migration is required.

## 2026-10-19 — Full-catalog white pair badges

Status: implementation and testnet data application complete; Railway API/web deployment remains pending explicit approval.

- Expanded ticker artwork from five active markets to all `101/101` catalogued Stock Tokens, including stocks, ADRs, and ETFs regardless of testnet route status.
- Validated every remote response for successful status, `image/webp`, bounded size, and a real RIFF/WebP signature before database application; there were zero failures.
- Replaced the earlier shared Robinhood mark with per-ticker artwork from Eulerpool's keyless ticker endpoint. No new credential or browser-visible key is required.
- Replaced the wide USDG artwork with its square crypto brandmark and added a validated WETH brandmark to every pons pair through database metadata.
- Made both overlapping circles white with white borders and black SVG fallbacks. The same reusable component covers active and reference-only rows.
- The pons `TEST` base asset still uses the honest SVG fallback because no contract-matched base artwork exists, while its WETH quote circle uses the validated WETH mark.

Validation:

- Remote logo validation passed `101/101`; USDG and WETH WebP signatures also passed.
- Testnet database curation applied `101/101` Stock Token records and all pons quote metadata successfully; mainnet remained untouched.
- Indexer and web strict TypeScript and lint checks passed; repository whitespace validation passed.

Owner action needed:

- Approve Railway deployment of API and web so the deployed API exposes quote-logo metadata and the deployed web renders the white overlapping pair badges.

## 2026-10-18 — Railway release of external-market execution and verified history

Status: API and web deployment completed successfully; Slice 19 remains 98% and the expanded roadmap remains approximately 92% (`122/132`).

- Deployed `@zkblast/api` deployment `effca3c3-c34b-44bf-8e44-894925de95cd` to the Railway `production` environment after the testnet database migration was verified.
- Deployed `@zkblast/web` deployment `54813ac5-0071-4364-a6dc-9744b9b2398a` only after the API deployment became healthy.
- Railway build logs confirm the Next.js production build compiled, type-checked, generated all nine routes, and completed successfully.
- Public smoke tests confirmed API health, real market reads, a `200` web response, expected ZKBLAST/Markets content, and a `401` response for an unauthenticated trade-confirmation request.
- No local environment file, Supabase credential, RPC credential, private key, private receipt, `docs/`, or evidence directory was uploaded.
- Mainnet contracts and the mainnet database were not changed.

Owner action needed:

- Manually connect and log in with a funded testnet wallet at `https://zkblastweb-production.up.railway.app`, then execute one of the four enabled USDG swaps and confirm that it appears in Recent trade history.
- Do not approve the separate pending GitHub-triggered Railway deployment unless you intentionally want that Git commit to replace the verified CLI release.

## 2026-10-18 — External route and receipt operational monitoring

Status: monitoring task complete; Slice 19 remains 98% (`5/6`, with catalog-wide execution mapping outstanding) and the expanded roadmap is approximately 92% (`123/133`).

- Extended the existing operations health response instead of adding a parallel monitoring subsystem.
- Added a database aggregate for validated route count, stale validated route count, and latest route observation time.
- Added bounded in-process receipt confirmation/failure counters using a 15-minute default window. No wallet address, transaction hash, calldata, RPC URL, or credential is retained in the metric.
- Added `EXTERNAL_ROUTE_STALE` and `TRADE_RECEIPT_FAILURES` alerts alongside the existing RPC lag, indexing drift, pool accounting, pause, and transaction-failure alerts.
- Added optional server-only thresholds with safe defaults: `ALERT_EXTERNAL_ROUTE_AGE_SECONDS` and `ALERT_RECEIPT_FAILURES`. No new browser variable was introduced.

Validation:

- API tests passed `22/22`, including alert activation, healthy thresholds, successful receipt counting, and rejected cross-wallet receipt counting.
- API typecheck and lint passed; focused formatting, environment-boundary, and repository whitespace checks passed.
- No Railway deployment, database migration, contract transaction, or mainnet change was performed for this monitoring task.

Owner action needed:

- No environment value is required because both thresholds have defaults. Add explicit Railway values later only if you want thresholds different from testnet defaults (`86400` seconds and `5` failures).
- Deployment of this monitoring update requires a new explicit Railway approval.

## 2026-10-18 — Database drift, seed policy, and rollback gate

Status: Slice 03 database safety task complete; Slice 03 is now `8/10`, and the expanded roadmap is approximately 93% (`124/133`).

- Expanded live schema verification from 13 baseline tables to all 20 current backend-only application tables, including reorg-safe events and external-market persistence.
- Added critical-column drift assertions for trade receipts/gas, ingestion checkpoints, canonical protocol events, and executable external-market routes.
- Added an explicit idempotent `db:seed:testnet` command backed only by the validated ZKBLAST testnet deployment manifest.
- Added an executable mainnet seed refusal guard and a static policy check that rejects seed-named mainnet migrations or replacement of the refusal command.
- Added a forward-only rollback/recovery runbook covering writer shutdown, provider recovery points, compatible application rollback, compensating migrations, schema/RLS re-verification, and canonical indexer recovery.
- Ran the validated testnet seed once: it upserted the two verified launch assets and one active pool without creating synthetic market data.

Validation:

- Live read-only verification passed for 20 testnet application tables with RLS, service-role access, browser-role denial, critical columns, and cross-schema isolation.
- Migration isolation, seed policy, environment security, formatting, and repository whitespace checks passed.
- A direct mainnet seed attempt failed with `MAINNET_DATABASE_SEED_PROHIBITED` as required.
- No mainnet connection, Railway deployment, contract transaction, or migration was performed.

Owner action needed:

- No environment value or immediate action is required.
- Before a future destructive migration, create a provider-managed recovery point and record its reference privately as required by `docs/DATABASE_ROLLBACK_RUNBOOK.md`.

## 2026-10-18 — Deployment signer-role and explorer preflight gate

Status: remaining Slice 02 deployment preflight task complete; Slice 02 is now `14/15`, and the expanded roadmap is approximately 94% (`125/133`).

- Extended the deployment preflight to require an HTTPS explorer URL and a successful structured Blockscout API response before any deployment transaction can begin.
- Preserved the existing checks for environment, chain ID, manifest boundary, signer key format, signer native balance, distinct nonzero governance/upgrader addresses, and mainnet multisig/timelock bytecode plus minimum delay.
- Explorer and RPC failure messages redact endpoint details and never print keys or credentials.
- Ran the complete preflight against chain `46630`; RPC identity, funded deployer, role-address policy, and explorer API checks passed.

Validation:

- Contract tooling typecheck and focused formatting passed.
- The first unsupported explorer probe failed closed before any write; the final probe uses the same structured contract-source API family as the existing verified-source tooling and passed.
- No deployment transaction, Railway release, database migration, or mainnet connection was performed.

Owner action needed:

- No environment value is required; the existing testnet explorer configuration is valid.
- The deployer currently has approximately `0.00961027674` native testnet ETH. Re-fund it before a future deployment if operational gas estimates approach that balance.

## 2026-10-18 — Testnet market availability separation

Status: approved market-visibility task complete; Slice 19 remains 98% (`6/7`, catalog-wide execution mapping outstanding) and the expanded roadmap remains approximately 94% (`126/134`).

- Kept every validated Pons, US stock, and China stock reference market discoverable under a new default `All markets` view.
- Added independent availability filters for `All`, `Active on testnet`, and `Reference only` without conflating source, region, or reference-chain status.
- Added explicit per-market execution language: `Active on testnet` plus `Trading enabled` only for a validated chain-46630 route; all other records show `Reference only` and `No validated route`.
- Preserved USDG/WETH candidate status visibility (`planned`, `observed`, `validated`, or `disabled`) and kept the swap panel gated by the existing validated-route check.
- Moved the internal regression-symbol exclusion to a small JSON policy file and removed ZKTA/ZKTB pools and positions from public protocol views without deleting their test/recovery records.
- Used Lucide SVG icons for status indicators; no emoji or character-symbol icon was added.

Validation:

- Web typecheck, lint, architecture boundary, environment security, formatting, and repository whitespace checks passed.
- The focused Next.js production build compiled successfully and completed type validation.
- No database row, contract, mainnet configuration, or Railway deployment was changed.

Owner action needed:

- No environment value is required.
- The UI change is local until a separately approved Railway deployment.

### Railway release

- Owner approved the web-only release.
- Deployed `@zkblast/web` deployment `777fa6c9-9984-485c-86d7-2ef96ac2d025`; Railway reported `SUCCESS`.
- Railway production build compiled, type-checked, generated all nine routes, and exported the runtime image successfully.
- Public smoke test returned HTTP `200` and confirmed `All markets`, `Active on testnet`, and `Reference only` in the production HTML; ZKTA/ZKTB were absent from the initial public document.
- The previously pending GitHub-triggered deployment was removed by Railway during this verified CLI rollout and can no longer overwrite it.

## 2026-10-18 — Slice 18 reference-market and chart boundary

Status: 33% for Slice 18 (`2/6`); expanded tracked roadmap is approximately 91% (`115/127`).

- Separated the mainnet reference-data chain from the optional execution chain. A testnet runtime can display chain `4663` observations without treating mainnet contracts as testnet transaction targets.
- Added constrained region, market-cap, market-cap timestamp, oracle identity, candidate-logo, approved-logo, and logo-review fields.
- Added immutable chart points with explicit `swap` or `oracle` provenance. Swap points require a block number and transaction hash; oracle points cannot masquerade as transactions.
- Added a bounded 31-day chart API with an explicit source selector and a 2,000-point response ceiling.
- Kept provider logos quarantined as candidates. Only a manually approved URL can be returned to the browser; missing and pending logos use SVG UI icons.
- Added the USD market-cap threshold and region filters to the market API boundary. The pons ingestion calculation and authoritative stock-region curation remain intentionally incomplete, so unverified values are not fabricated.

Validation:

- API, indexer, and web TypeScript checks passed.
- API tests passed `18/18`; focused API and web lint passed after removing an unsupported lint-rule directive.
- Database migration isolation checks passed.

Owner action needed:

- No new environment value is required for the completed foundation.
- Confirm whether “China stock” should include only China-linked Robinhood Stock Tokens, or also mainland A-shares/Hong Kong listings from a separate licensed provider. Current implementation assumes only Robinhood Stock Tokens.
- Chainlink Data Streams credential values will be needed before live oracle report ingestion can be enabled. They will remain server-only and will not use a `NEXT_PUBLIC_` prefix.
- No Railway deployment was performed. Deployment still requires separate approval.

## 2026-10-18 — Slice 18 real swap chart increment

Status: approximately 55% implementation progress for Slice 18; `2/6` roadmap tasks are fully closed because oracle ingestion, market-cap filtering, and authoritative region curation remain open. Expanded roadmap remains approximately 91% (`115/127`).

- Added a bounded, checkpointed Uniswap V3 Swap ingester for graduated pons v1 pools on Robinhood Chain mainnet.
- Derived token/quote price from canonical `sqrtPriceX96`, on-chain token ordering, and token decimals instead of trusting a third-party calculated price.
- Required every stored swap point to carry its canonical transaction hash, block number, timestamp, and a log-specific source hash.
- Ran the first testnet-schema reference sync: two graduated markets scanned and one real swap point persisted. No mock or synthetic candle was generated.
- Added a reusable seven-day SVG market chart and explicit `Swap` / `Oracle` source tabs. Missing oracle records render an empty state.
- Added server-only Chainlink credential placeholders to `.env.testnet` and both committed environment templates. None use a `NEXT_PUBLIC_` prefix.

Validation:

- API tests passed `19/19`, including explicit chart-source provenance.
- API, indexer, and web TypeScript and lint checks passed.
- Environment public/private boundary, browser architecture, and repository whitespace checks passed.

Owner action needed:

- Obtain Chainlink Data Streams access, then fill `CHAINLINK_DATA_STREAMS_API_KEY`, `CHAINLINK_DATA_STREAMS_USER_SECRET`, and `CHAINLINK_DATA_STREAMS_ENDPOINT` in `.env.testnet`. Do not send these values through chat and do not add a `NEXT_PUBLIC_` prefix.
- The credentials must grant access to mainnet streams because the testnet UI intentionally displays mainnet reference markets. A testnet Data Streams endpoint would produce the wrong reference-data environment.
- No Railway deployment was performed; it still requires explicit approval.

## 2026-10-18 — Slice 18 free reference-data path

Status: approximately 65% implementation progress for Slice 18; the strict roadmap remains `2/6` fully closed pending market-cap filtering, region curation, and public on-chain feed discovery.

- Removed the planned mandatory Chainlink Data Streams subscription and its credential placeholders from local and committed environment files.
- Added an explicit `reference` chart provenance alongside `swap` and `oracle`. Reference data cannot be mislabeled as cryptographically verified oracle data.
- Persisted midpoint price history from the official keyless Robinhood Stock Token API while retaining original bid/ask snapshots and source hashes.
- Added a third `Reference` chart selector to the reusable market chart.
- Applied migration `202610180009_reference_price_source.sql` to `zkblast_testnet` only; mainnet remains untouched.
- Completed a live sync using free sources: one newly observed pons record and 100 active Stock Token quotes/reference points at Robinhood Chain block `91798747`.

Validation:

- API tests passed `19/19`.
- API, indexer, and web type checks and lint passed for the affected modules.
- Database isolation, testnet RLS verification, environment boundary, browser architecture, and repository whitespace checks passed.

Owner action needed:

- No paid subscription, API key, or new environment value is required for the current `swap` and `reference` chart paths.
- Free/public RPC endpoints are rate-limited. The existing Alchemy free-tier mainnet RPC may be used through server-only `PONS_RPC_URL` when public RPC throughput becomes insufficient.
- No Railway deployment was performed; it still requires explicit approval.

## 2026-10-18 — Slice 18 public on-chain oracle ingestion

Status: approximately 80% implementation progress and 67% checklist completion for Slice 18 (`4/6`). Expanded roadmap is approximately 92% (`117/127`).

- Added dynamic discovery of Robinhood Chain feed proxy addresses and heartbeats from Chainlink's public source-of-truth registry; no per-symbol feed address is hardcoded in application source.
- Read `AggregatorV3Interface.decimals()` and `latestRoundData()` through the existing server-side mainnet RPC with no Data Streams subscription.
- Rejected zero/negative answers, incomplete rounds, future timestamps, stale continuous feeds, and tokens reporting `oraclePaused=true`.
- Added a bounded weekend grace only for documented 24/5 equity feeds whose last observation is Friday. Continuous ETH/USD remains subject to its strict heartbeat.
- Discovered 35 Stock Token feeds, matched 23 against the current 100-row catalog, and persisted 23 verified on-chain oracle points. The independent keyless API series remains available as 100 `reference` points.
- Read the public ETH/USD on-chain feed and calculated burn-adjusted pons market cap from circulating supply and the latest canonical WETH-denominated swap price.
- Enforced the USD 1,000,000 filter in the browser's pons query. The only pons market with sufficient fresh inputs currently calculates to USD 240,699.54 and is therefore correctly excluded; markets without fresh swap inputs remain unvalued and excluded.
- Applied migration `202610180010_oracle_heartbeat.sql` to `zkblast_testnet` only. Mainnet remains untouched.

Validation:

- Indexer and web type checks and lint passed.
- Database migration isolation and testnet RLS verification passed.
- Live on-chain reads succeeded without paid credentials.

Owner action needed:

- No API key, paid subscription, environment value, testnet funding, or deployment action is required.
- The current pons list may legitimately be empty because no validated market currently satisfies every graduation, freshness, and USD 1,000,000 condition.
- No Railway deployment was performed; it still requires explicit approval.

## 2026-10-18 — Slice 18 market curation and logo approval workflow

Status: approximately 95% implementation progress and 83% checklist completion for Slice 18 (`5/6`). Expanded roadmap is approximately 93% (`118/127`).

- Added auditable server-only market curation with identity binding to both symbol and canonical Stock Token contract address.
- Generated `data/market-curation.testnet.json` containing all 100 current candidates, their region decision, candidate logo URL, decision state, and human-readable reasons.
- Applied an initial explicit region curation: 98 US-market records and two China-linked records (`BABA`, `FUTU`). These remain owner-reviewable rather than inferred at runtime.
- Kept all 100 logos in `pending`; no candidate URL was approved or returned to the browser automatically.
- Restricted logo approval to exact HTTPS URLs on `cdn.robinhood.com` whose path contains the same canonical contract address. Query strings, fragments, credentials, host substitutions, and contract mismatches are rejected.
- Added immutable curation audit rows recording previous value, next value, reason, curator, market, and timestamp.
- Added separate web tabs for `pons > $1m`, `US stocks`, and `China stocks`, backed by API region filters rather than client-side name guessing.
- Applied migration `202610180011_market_curation_audit.sql` to `zkblast_testnet` only. Mainnet remains untouched.

Validation:

- All 100 current Stock Tokens were present exactly once in the curation file and applied successfully.
- Testnet summary: 98 `us`, two `china`, 100 `pending` logos, and 100 region audit entries.
- API tests passed `19/19`; affected indexer/web type checks and lint passed.
- Testnet RLS verification and database isolation checks passed.

Owner action needed:

- Review `data/market-curation.testnet.json`, especially the initial China-linked classification of `BABA` and `FUTU`.
- For each logo you visually confirm, change only `logoDecision` from `pending` to `approved` and replace `logoReason` with a meaningful review note. Use `rejected` when the image is incorrect or unsuitable.
- After editing, request that the curation be applied. The command validates the complete file atomically and records every decision in the audit table.
- No Railway deployment was performed; it still requires explicit approval.

## 2026-10-18 — Slice 19 USDG/WETH pair readiness

Status: 98% for Slice 19 (`4/5`; four USDG routes now support live web quote/execution and receipt-derived user history while catalog-wide mapping remains); expanded roadmap is approximately 92% (`122/132`). Slice 18 remains at `5/6` pending owner curation review.

- Added isolated `external_market_pairs` persistence with separate reference and execution chain identity, base/quote addresses, priority, route status, venue, pool, fee tier, raw protocol liquidity, observed block/time, validation timestamp, and bounded metadata.
- Corrected the chain boundary after review: market metadata and charts may reference mainnet chain `4663`, but testnet transactions must use execution chain `46630` assets only.
- Verified the selected testnet USDG and WETH contracts directly through the configured testnet RPC: chain `46630`, deployed bytecode, symbol, and decimals all match (`USDG/6`, `WETH/18`). No RPC or credential is exposed to the browser.
- Replaced the testnet pair rows with 203 chain-`46630` candidates: 100 USDG and 103 WETH. All remain `planned`; none has an execution base-token mapping yet, so none can become executable.
- Added database checks requiring testnet execution chain `46630`, syntactically valid execution token addresses, and positive observed liquidity plus block/time evidence before `validated` is permitted.
- Made pair synchronization invalidate prior pool evidence whenever execution chain, base token, or quote token identity changes.
- Added a versioned testnet execution-token mapping file and an atomic mapper that rejects wrong RPC chain, missing bytecode, symbol/decimal mismatch, zero supply, duplicate symbol/address, quote-token collision, or absent reference market.
- Verified and mapped four active faucet markets at block `138089104`: AMD, AMZN, NFLX, and PLTR. They produce eight same-chain USDG/WETH candidates. Testnet faucet tokens are explicitly labeled `testnet_faucet_token`; they are not represented as canonical mainnet Stock Tokens.
- Added a ZKBLAST-native route scanner that reads `PoolCreated` events in RPC-bounded chunks and verifies registry membership, pool bytecode, factory identity, token ordering, fee, and live pool shares.
- Scanned eight mapped candidates through testnet block `138090240`; no matching ZKBLAST pool currently exists, so all statuses correctly remain `planned`.
- Confirmed the governance signer matches the deployed factory administrator and currently holds testnet gas, USDG, and all four mapped base tokens. WETH balance is zero, so the first executable pools should use USDG.
- Created and seeded four ZKBLAST DAMM pools on chain `46630`: AMD/USDG, AMZN/USDG, NFLX/USDG, and PLTR/USDG. Each pool received `0.01` base token and `2` USDG of initial test liquidity at `3,000` fee pips.
- Recorded a resumable private journal and a reviewed public deployment artifact with every pool address, transaction hash, block number/hash, gas used, effective gas price, and total fee.
- Completed four bounded base-to-USDG swap E2E transactions after server-side quotation and a 1% minimum-output guard.
- Re-ran independent route discovery through block `138101582`. All four USDG routes are now `validated` with nonzero pool shares; all WETH candidates correctly remain `planned`.
- Live API verification confirms AMD, AMZN, NFLX, and PLTR now return `canTrade=true` from their validated chain-`46630` USDG route only.
- Added a market-scoped quote endpoint that resolves the pool, base token, decimals, venue, and execution chain exclusively from a fresh `validated` database route. The browser cannot nominate an arbitrary pool or token address.
- Amount conversion now occurs on the server from the validated base-token decimals; the API applies bounded slippage and returns exact approval plus swap calldata produced by the deployed ZKBLAST quoter/router stack.
- Added a reusable web trade panel to the selected external market. It appears only for a validated USDG route, supports wallet network switching, exact approval, swap submission, receipt waiting, explorer linking, and clear failure states.
- Added authenticated post-swap confirmation. The server verifies the transaction signer, configured router, validated pool and base token, receipt success, recipient, calldata amount, and canonical pool `Swap` event before persisting anything.
- Trade history now uses receipt-derived input, output, fee, block, timestamp, gas used, and effective gas price. A different logged-in wallet cannot claim another wallet's transaction, and idempotent retries cannot change trade ownership.
- Completed a live AMD/USDG endpoint smoke test: chain `46630`, `0.001` AMD input, nonzero contract quote, 0.5% minimum-output protection, and nonempty approval/swap calldata.
- Added pair execution chain, base token, and raw-liquidity fields to the server API contract. `canTrade` now requires at least one `validated` pair rather than relying only on a market-level chain field.
- Applied migrations `202610180012` and `202610180013` to `zkblast_testnet` only. Mainnet remains untouched.

Validation:

- Indexer, API, and web type checks passed.
- Migration isolation, testnet RLS verification, and environment public/private boundary scan passed.
- Live aggregate verification confirmed all 203 pair candidates use execution chain `46630`; zero candidates are falsely marked `observed` or `validated`.
- Mapper and route scanner type checks and lint passed; the mapper rolled back atomically when an initial TSLA candidate was absent from the active reference catalog.
- Contract tooling typecheck passed. The final artifact contains 24 successful transactions, `8,391,226` aggregate gas used, and `83,912,260,000,000` wei aggregate testnet fee.
- API tests pass `22/22`, including receipt derivation and cross-wallet claim rejection; API and web type checks and lint pass after the market-scoped execution integration.
- Migration `202610180014_trade_history_receipt_gas.sql` was applied and verified only in `zkblast_testnet`; mainnet remains untouched. Migration isolation and repository whitespace checks pass.

Owner action needed:

- No environment value is required. The verified testnet execution addresses are already populated server-side.
- No action is required for the four USDG routes or authenticated trade-history persistence. You can manually validate it by logging in with the same wallet used for the swap, executing an enabled USDG market trade, and opening the account history after confirmation.
- WETH routes remain planned. To activate them later, the governance wallet needs testnet WETH before pool creation and liquidity seeding.
- Manual logo/region review in `data/market-curation.testnet.json` remains outstanding.
- No Railway deployment was performed; it still requires explicit approval.

## 2026-10-18 — Slice 17 external market catalog foundation

Status: 20% for Slice 17 (`1/5`); the persistence and validation boundary is complete before external ingestion begins.

- Added separate `external_markets` and append-only `external_market_quotes` tables to both `zkblast_testnet` and `zkblast_mainnet` migrations.
- Restricted sources to `pons_graduated` and `robinhood_stock_token`, chain ID to Robinhood Chain mainnet `4663`, and contract identities to normalized EVM addresses.
- Added uniqueness, status, symbol/name length, nonnegative quote/volume, non-crossed bid/ask, payload-size, timestamp, and immutable source-hash constraints.
- Enabled row-level security with no browser write policy. Ingestion remains server-side through the direct database connection.
- Added strict runtime schemas for Robinhood Stock Token `/assets` and `/prices` responses and for fully verified pons graduated records.
- Kept every external market read-only by default; an external price snapshot is never an executable ZKBLAST swap quote.

Validation:

- Database package tests and typecheck passed.
- Mirrored migration structure and environment isolation checks passed.

Owner action needed:

- No value is required yet. The official Robinhood stock endpoints and public Robinhood Chain RPC do not require an API key for the initial read-only integration.
- No database migration has been applied yet; explicit approval will be requested after the pons and stock ingestion jobs plus rollback checks are complete.

## 2026-10-18 — Slice 17 external markets testnet vertical slice

Status: 100% for Slice 17 (`5/5`); tracked atomic roadmap returns to approximately 93% (`113/121`).

- Added checkpointed, bounded log ingestion for the documented pons v1 active and legacy factories and the v2 factory on Robinhood Chain mainnet.
- Verified v1 `graduationStatus` on-chain and accepted only `graduated=true`; verified v2 launch records and accepted only authoritative `phase=2` pool-created records.
- Kept v1 Uniswap V3 pool addresses and v2 Uniswap V4 pool identifiers distinct instead of inventing a v4 pool address.
- Added active Robinhood Stock Token metadata and per-symbol price synchronization from the documented `/assets` and `/prices/{symbol}` endpoints.
- Enforced chain 4663 deployments, bid/ask ordering, multiplier metadata, trading-halt status, timestamps, nonnegative volume, and source hashes before persistence.
- Added paginated `/v1/markets` reads with provenance, freshness, source chain, and an explicit `canTrade=false` capability.
- Added a reusable landing-page external-market board with `pons graduated` and `US stock tokens` tabs. It contains no mock rows and shows an empty/unavailable state when the API has no validated data.
- Applied migration `202610180006_external_market_catalog.sql` to `zkblast_testnet` only. Mainnet was not migrated.
- Completed the first idempotent testnet sync: 2 on-chain-verified pons records and 100 active Stock Token records/quotes at observed Robinhood Chain block `91534593`.
- Stored independent checkpoints for v1 active, v1 legacy, and v2 so wide historical backfills continue forward without skipping old launches.

Validation:

- Database tests passed `5/5`; API tests passed `18/18` including the non-executable market capability response.
- Database, API, indexer, and web type checks passed; API, indexer, and web lint passed.
- Migration isolation, environment security, browser architecture, branding, formatting, and repository whitespace checks passed.

Not deployed:

- The API/web/indexer changes have not been deployed to Railway.
- Mainnet Supabase migration remains prohibited until the mainnet release gate.

Owner action needed:

- No environment value is required. The integration currently uses documented keyless read-only endpoints.
- A Railway release requires a separate explicit deployment approval. Until then, the new rows and schema exist in Supabase testnet but the public Railway API/web do not expose them.
- Review `docs/ADR-003-SHIELDED-SWAP-RESEARCH.md`. Advancing to a proof of concept requires an explicit design approval covering the public-input/private-witness schema, batch clearing mechanism, solver assumptions, oracle policy, refund/reorganization semantics, and measurable minimum privacy conditions.
- Independent cryptography, smart-contract, mechanism-design, and privacy review remains required before a future proof of concept can graduate into production work.

## 2026-10-18 — Slice 15 local research PoC complete

Status: 100% for the Slice 15 research gate (`3/3`); tracked atomic roadmap is approximately 92% (`107/116`). Production private swaps remain explicitly unapproved.

- Recorded owner approval to proceed with the batched-intent direction as a local proof of concept.
- Added an isolated SDK research model with no proof-verification bypass, custody contract, token movement, persistence, runtime route, or deployment path.
- Made uniform asset-pair clearing, integer fee calculation, conservative output rounding, per-intent fee bounds, minimum output, deadline, and unique nullifier requirements executable.
- Added a local disposition ledger in which an intent can become either settled or refunded exactly once. Failed batches mutate no dispositions, and refunds are available only strictly after expiry.
- Kept the ADR status explicit: the local research direction is approved, but production circuit, contract, solver network, custody integration, and privacy claims are not approved.

Validation:

- SDK tests passed `9/9`, including five batched-intent PoC cases.
- SDK strict TypeScript checking passed.
- Focused formatting, repository whitespace, environment-boundary, and legacy-brand checks passed.

Owner action needed:

- No environment value, testnet funding, or deployment approval is required for this completed research slice.
- Before any production implementation, commission independent cryptography, smart-contract, mechanism-design/MEV, and privacy reviews of an exact circuit and settlement proposal. The current SDK PoC must not be treated as an authorization to deploy.

## 2026-10-18 — Environment-bound deployment manifest loader

Status: Slice 02 manifest-loader task complete; tracked atomic roadmap is approximately 93% (`108/116`).

- Added a Node-only manifest file loader in `@zkblast/config/node`. It reports read/JSON failures clearly, validates the complete schema, and rejects environment or chain mismatches before returning any addresses.
- Replaced independent manifest parsing in the API, continuous indexer, market backfill, shielded backfill, deployment verification, and deployment audit paths.
- Kept SDK address resolution behind the shared schema parser.
- Preserved the browser security boundary: web code does not read the filesystem manifest and receives only the API's sanitized public network/contract projection. RPC, Supabase, and signer configuration remain server-only.
- Added explicit workspace dependencies instead of relying on undeclared transitive package availability.

Validation:

- Config, SDK, API, indexer, and contract-tooling TypeScript checks passed.
- The live testnet manifest passed the shared loader; deliberate environment and chain mismatches were rejected.
- Web architecture, environment-boundary, legacy-brand, formatting, and repository whitespace checks passed.
- No contract, database, testnet, or Railway deployment was performed.

Owner action needed:

- No environment value or deployment action is required.

## 2026-10-19 — Shielded USDG and recovery readiness

Status: Slice 20 is **60%** (`3/5`); the complete roadmap is **94.7%** (`143/151`). Remaining Slice 20 gates require a genuinely independent reviewer and additional real chain-46630 execution tokens.

- Enabled USDG on the deployed testnet Shielded Vault at address `0x7E955252E15c84f5768B83c41a71F9eba181802F` with a fixed one-USDG denomination (`1000000` raw units).
- Recorded governance transaction `0xc6d7de67b5fdbf62e950ca6d261c7a72b174c20afdb251a7bfa34813d4bd0d10`, block `138558406`, gas `53518`, and total fee `535180000000` wei in the public manifest and dedicated evidence artifact.
- Added an idempotent, simulation-first configuration command with signer, chain, token symbol/decimals, bytecode, gas-balance, receipt, and post-state validation.
- Passed all `54` contract tests, circuit architecture validation, one positive and six negative withdrawal vectors, six protocol regression vectors, and storage compatibility for five upgradeable contracts.
- Passed a non-destructive live testnet recovery rehearsal at block `138559222`, covering environment isolation, deployed runtimes, USDG configuration, current root recovery, pause-state observation, and runbook integrity.
- Verified the deployment manifest for ten contracts and nine explorer source addresses.
- Published an independent-audit handoff for contracts, circuits, generated artifacts, and Shielded LP Manager accounting. This is preparation, not an external audit approval.
- Preserved an open readiness finding: strict deployment reproduction detects a creation-input mismatch for the latest `ZKBlastVault` implementation. Runtime bytecode matches the manifest, but the exact creation artifact must be reconstructed and frozen before mainnet approval.
- Confirmed that only five real testnet Stock Token mappings are presently documented. No mainnet address, reference-only record, or fabricated token was promoted into an executable chain-46630 route.

### Action required from owner

- Redeploy/restart the API and web services from this revision so both services reload the updated manifest and expose USDG on the Shielded page. Do not add the governance private key to either public-facing service.
- Contract an independent auditor and give them the exact review commit plus `docs/INDEPENDENT_AUDIT_HANDOFF.md`. Require a signed report with zero unresolved critical/high findings and explicit Shielded LP Manager coverage.
- For more than five executable markets, provide independently verifiable chain-46630 token contract addresses and ensure the governance wallet receives each base token plus sufficient testnet USDG. A mainnet/reference token address is not acceptable for testnet execution.

## 2026-10-19 — Real web LP lifecycle complete locally

Status: Slice 21 is **100%** (`4/4`); the complete roadmap is **94.8%** (`147/155`). Deployment remains owner-approved only.

- Replaced the remaining simulated liquidity path with a real Pools-page composer for AMD/USDG, AMZN/USDG, NFLX/USDG, PLTR/USDG, and TSLA/USDG validated routes.
- Derived the paired USDG amount from reconciled on-chain DAMM reserves, submitted two exact approvals, and used a 1% minimum LP-share safety bound through the deployed Position Manager.
- Added direct Position Manager reads scoped to the connected wallet, so current positions and shares do not depend on dummy data or an asynchronous database projection.
- Added owner-only 25%, 50%, 75%, and 100% liquidity removal from the Positions page, with a server-enforced 1% minimum token-out bound, receipt links, transaction states, and post-confirmation refresh.
- Kept the API fail-closed on chain, registered pool, token ordering, owner, and available shares. Reference-only markets cannot prepare position calldata.
- API tests passed `26/26`, web tests passed `14/14`, targeted liquidity tests passed `6/6`, API/web lint and typecheck passed, and both production builds completed successfully.

### Action required from owner

- Deploy/restart both Railway API and web services from this revision. Both are required: the web contains the liquidity controls and the API contains live Position Manager reads plus removal safety bounds.
- After deployment, connect a funded chain-46630 wallet, start with a small `0.001` base-token amount, approve both exact amounts, confirm the Position Manager transaction, then open Positions and remove 25% before testing a full close.

## 2026-10-19 — Parallel mainnet development path started

Status: Slice 22 is **60%** (`3/5`); the expanded roadmap is **93.8%** (`150/160`). Testnet remains operational and no mainnet transaction, migration, or Railway deployment was performed.

- Added a canonical six-service matrix for `web-testnet`, `api-testnet`, `indexer-testnet`, `web-mainnet`, `api-mainnet`, and `indexer-mainnet`, with service-specific build/start commands and secret boundaries.
- New web services use only server-side `API_URL`; Next.js continues to proxy `/api/*`, so the backend hostname, RPC, Supabase URL, keys, and credentials are not exposed to browser JavaScript.
- Added mainnet API/indexer development commands plus mainnet external-market, swap, oracle, and pair synchronization commands.
- Added an automated parallel-service boundary checker and corrected the shared task runtime variable name to `WS_RPC_URL`.
- Confirmed mainnet HTTP/WSS network configuration resolves to chain `4663`.
- Verified `zkblast_mainnet` contains all 20 backend-only application tables with RLS. No migration or data write was performed.
- Mainnet readiness remains correctly blocked at `4/8`: governance multisig, proxy-admin/timelock, reviewed manifest, independent audit, and approved recovery evidence are not yet available.

### Action required from owner

- Create or nominate a mainnet governance multisig contract and a separate timelocked proxy-admin contract. Provide their addresses as `GOVERNANCE_MULTISIG_ADDRESS` and `PROXY_ADMIN_ADDRESS`; do not reuse a testnet EOA as either authority.
- Commission the independent audit using `docs/INDEPENDENT_AUDIT_HANDOFF.md` and resolve the open Vault creation-artifact reproducibility finding before deployment approval.
- Do not create or activate the mainnet Railway services yet. Once contracts, manifest, audit, and recovery evidence pass, configure all three mainnet services from `deploy/railway-services.json` and keep all three testnet services running unchanged.

## 2026-10-19 — Mainnet governance foundation complete locally

Status: Slice 22 is **67%** (`4/6`); the expanded roadmap is **93.8%** (`151/161`). No mainnet transaction was submitted.

- Pinned OpenZeppelin Contracts `5.7.0` and added `ZKBlastTimelock`, keeping mainnet upgrade authority on a reviewed upstream timelock instead of introducing a custom scheduler.
- Enforced a minimum delay of 48 hours, one governance Safe as proposer/executor/canceller, self-administration only, and rejection of zero governance or a shorter delay.
- Added a mainnet-only deployment workflow with an explicit one-shot confirmation, chain `4663` validation, runtime code checks, deployer gas validation, Safe owner/threshold validation, post-deployment role checks, and public receipt/gas/fee/bytecode evidence.
- Hardened the general deployment preflight so mainnet requires at least two Safe owners, threshold two, sufficient timelock delay, and proposer/executor/canceller roles assigned to the exact governance Safe.
- Targeted Solidity tests passed `3/3` and the contracts TypeScript tooling passed. `solhint` remains unavailable in the local dependency set; no lint success is claimed.

### Action required from owner

- Create a mainnet Safe with at least two independent owner addresses and threshold at least two, then place only its public contract address in `GOVERNANCE_MULTISIG_ADDRESS`.
- Do not place Safe owner private keys or seed phrases in any environment file. Once the Safe address is supplied and independently checked, the timelock deployment can be separately approved and executed.

## 2026-10-19 — Mainnet address parity policy verified

Status: Slice 22 is **71%** (`5/7`); the expanded roadmap is **93.8%** (`152/162`). No transaction was submitted.

- Confirmed locally, without exposing keys, that testnet and mainnet use the same deployer private key and therefore the same deployer address: `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B`.
- Read both chains and found testnet deployer nonce `44` versus mainnet nonce `325`. Existing testnet protocol addresses were created with nonce-based CREATE deployments, so reproducing those exact contract addresses on mainnet is not possible from the current state.
- Kept testnet governance/upgrader EOAs out of mainnet governance roles. A testnet EOA address cannot be converted into a Safe or timelock contract at the same mainnet address.
- Verified mainnet USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` as deployed `USDG/6` and WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` as deployed `WETH/18` on chain `4663`.
- Added reusable chain-bound execution-asset verification commands for both testnet and mainnet. Token addresses remain chain-specific and cannot be copied from testnet.

### Action required from owner

- No action is needed for the deployer; it is already the same address on both networks and funded on mainnet.
- A mainnet Safe contract address is still required. It cannot equal the current testnet governance EOA address. Create a Safe with at least two independent owners and threshold two, then provide only its public address.

## 2026-10-19 — Mainnet Safe deployment path ready

Status: Slice 22 is **75%** (`6/8`); the expanded roadmap is **93.9%** (`153/163`). No mainnet transaction was submitted.

- Pinned the official `@safe-global/safe-deployments` registry at `1.37.58`, whose released Safe `1.4.1` records include chain `4663`.
- Added a mainnet-only Safe creation workflow that obtains the singleton, proxy factory, and compatibility fallback handler from that registry instead of hardcoding deployment addresses.
- Required at least two unique nonzero owners and threshold at least two, verified the official runtime bytecode hashes on-chain, previewed the deterministic Safe address, and simulated the deployment before any broadcast is allowed. The RPC refused final gas estimation because the deployer gas allowance/balance is currently insufficient for the estimated operation; no transaction was submitted.
- Added an exact one-shot confirmation gate and post-deployment checks for runtime code, ordered owners, and threshold. Successful execution will atomically record the Safe address, factory/singleton/handler, transaction hash, block, gas, fee, and runtime hash in `deployments/mainnet/safe.json`.
- Contracts tooling TypeScript checking passed. No broad monorepo build or repeated full suite was run.

### Action required from owner

- Provide at least two independent public owner addresses in the intended order and confirm the threshold. Recommended production policy is `2-of-2` at minimum; `2-of-3` is safer for recovery if three genuinely independent signers are available.
- Never provide seed phrases or private keys for Safe owners. Only public addresses belong in `MAINNET_SAFE_OWNERS`.
- After the owner list is confirmed, approve the predicted Safe address and estimated gas shown by the dry run. Only then should the one-shot mainnet broadcast gate be enabled.
- Fund the mainnet deployer with enough native ETH for the Safe, timelock, and later audited protocol deployments. The current positive balance is not sufficient for Safe gas estimation.

## 2026-10-19 — Mainnet Safe owners selected from testnet signers

Status: Slice 22 remains **75%** (`6/8`); the expanded roadmap remains **93.9%** (`153/163`). Safe deployment is configured but not broadcast.

- Derived and verified the public addresses of the existing testnet governance and upgrader signers without exposing or copying either private key.
- Configured those two public addresses as the ordered mainnet Safe owner set with a `2-of-2` threshold and salt nonce `0`.
- Re-ran the chain-4663 registry, runtime-hash, owner, threshold, address-prediction, and transaction simulation path. The final predicted Safe address is `0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8`.
- Kept the deployment confirmation unset. The RPC still rejects final gas estimation because the mainnet deployer does not have sufficient native gas allowance; no transaction was submitted.

### Action required from owner

- Fund mainnet deployer `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B` with native ETH. Fund enough for Safe, timelock, and subsequent audited protocol deployments rather than only one transaction.
- Confirm that both existing testnet signer wallets can sign mainnet chain `4663` transactions. Their private keys remain local and must never be added to Railway.
- After funding, explicitly approve broadcasting the Safe deployment. The confirmation flag must remain unset until that approval.

## 2026-10-19 — Mainnet Safe final dry-run passed

Status: Slice 22 remains **75%** (`6/8`); the expanded roadmap remains **93.9%** (`153/163`). The Safe is ready for an explicitly approved broadcast.

- Confirmed the mainnet deployer top-up is sufficient for RPC gas estimation.
- Revalidated official Safe `1.4.1` registry deployments and runtime hashes on chain `4663`.
- Revalidated the ordered two-owner set, `2-of-2` threshold, salt nonce `0`, and predicted Safe address `0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8`.
- The final simulation passed with estimated gas `289177`.
- Kept `CONFIRM_MAINNET_SAFE_DEPLOYMENT` unset and submitted no transaction because final broadcast approval has not yet been given.

### Action required from owner

- Review and explicitly approve the mainnet Safe broadcast. Approval will deploy the predicted address above and spend mainnet native gas from deployer `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B`.

## 2026-10-19 — Mainnet governance Safe deployed and verified

Status: Slice 22 is **78%** (`7/9`); the expanded roadmap is **93.9%** (`154/164`). The Safe deployment task is complete.

- Deployed Safe `1.4.1` on mainnet chain `4663` at `0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8` using the official singleton and proxy factory registry entries.
- Verified ordered owners `0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9` and `0x48e7BcFE8F469FBc72E6BcEf0D0cE70d51FFBbed`, threshold `2`, deployed proxy runtime, singleton, factory, and fallback handler.
- Confirmed successful transaction `0xfaf7379ee18e4f1c1c6e6e91fbdef8fa012f9e07eb0404d31d789c4254b49408` in block `92668761`, using `282359` gas at `20224000` wei effective gas price for a total fee of `5710428416000` wei.
- Stored the complete public evidence in `deployments/mainnet/safe.json` and configured the public Safe address as `GOVERNANCE_MULTISIG_ADDRESS` in the ignored mainnet environment file.
- The one-shot confirmation was supplied only to the deployment process and was not persisted in `.env.mainnet`.

### Action required from owner

- Confirm both Safe owner wallets can access chain `4663` and retain their seed backups separately. Both signatures are required for every Safe governance transaction.
- The next on-chain step is deployment of the 48-hour timelock controlled by this Safe. It requires a separate explicit approval and will spend additional mainnet gas.

## 2026-10-19 — Mainnet timelock policy reduced to five minutes

Status: Slice 22 remains **78%** (`7/9`); the expanded roadmap remains **93.9%** (`154/164`). No timelock transaction was submitted.

- Replaced the earlier 48-hour minimum with the owner-selected five-minute (`300` second) minimum in the timelock contract, deployment workflow, environment configuration, and roadmap.
- Retained the Safe-only proposer, executor, and canceller model plus self-administered role protection.
- Updated the focused contract test to reject `299` seconds while accepting and enforcing `300` seconds.
- Focused timelock tests passed `3/3`, contracts tooling type-check passed, and repository whitespace validation passed. No full monorepo build or repeated broad suite was run.
- This intentionally increases governance responsiveness at the cost of a substantially shorter monitoring and intervention window for a faulty or malicious scheduled upgrade.

### Action required from owner

- No environment value is required; `MIN_TIMELOCK_DELAY_SECONDS=300` is configured locally.
- A separate explicit approval is still required before the five-minute timelock is deployed to mainnet.

## 2026-10-19 — Five-minute mainnet timelock deployed and verified

Status: Slice 22 remains **78%** (`7/9`); the expanded roadmap remains **93.9%** (`154/164`). Mainnet governance and upgrade-control contracts are now deployed.

- Deployed `ZKBlastTimelock` on chain `4663` at `0x5D096a502e72bcD429b9E4A4907095Ee3931BD4d` with an on-chain minimum delay of exactly `300` seconds.
- Verified Safe `0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8` has proposer, executor, and canceller roles, while timelock administration remains self-controlled.
- Confirmed successful transaction `0xc1025aad421a9258c3543fe09c3bd92759d59ef684eeee7312f78c7674827f34` in block `92673796`, using `1603917` gas at `20396000` wei effective gas price for a total fee of `32713491132000` wei.
- Stored creation/runtime bytecode hashes and complete receipt evidence in `deployments/mainnet/governance.json`, then configured the public timelock address as `PROXY_ADMIN_ADDRESS` in the ignored mainnet environment file.
- The one-shot confirmation was supplied only to the deployment process and was not persisted.
- Mainnet readiness advanced from `4/8` to `5/8`: environment, chain, isolated database schema, complete server configuration, and runbooks pass. The reviewed deployment manifest, independent audit approval, and recovery rehearsal remain blocked.
- The general deployment preflight reached the explorer availability check, which the configured explorer API did not satisfy. Safe/timelock post-deployment verification and evidence succeeded independently; no false full-preflight success is claimed.

### Action required from owner

- No action is required for the completed timelock deployment.
- Before protocol deployment, both Safe owners should confirm they can sign on chain `4663`; subsequent upgrade operations require scheduling, waiting at least five minutes, and a separate Safe-authorized execution.

## 2026-10-19 — Mainnet protocol deployment plan frozen

Status: Slice 22 remains **78%** (`7/9`); the expanded roadmap remains **93.9%** (`154/164`). No protocol deployment transaction was submitted.

- Corrected the deployment preflight to test Blockscout web availability independently from source-publication API capability. The web explorer is available, while the source API currently returns HTTP `403` and remains a separate unresolved publication gate.
- Mainnet deployment preflight now passes chain `4663`, deployer balance, Safe bytecode and `2-of-2` policy, timelock bytecode, exact `300` second delay, Safe proposer/executor/canceller roles, and explorer availability.
- Added a read-only mainnet plan generator that freezes the current pending nonce, all nine predicted deployment addresses, artifact creation/runtime hashes, initializer arguments/calldata hashes, Safe owners/threshold, timelock, and reference block.
- Generated `deployments/mainnet/deployment-plan.json` from pending deployer nonce `327`. It is explicitly marked non-authorizing with both broadcast and independent-audit approval set to `false`; it is not accepted as a live deployment manifest.
- Contract tooling type-check, six deployable-artifact checks, and repository whitespace validation passed. No full build, repeated broad test suite, or mainnet protocol transaction was run.

### Action required from owner

- No additional environment value is required.
- Independent audit approval is still required before the planned nine protocol deployment transactions should be broadcast. The Blockscout source API restriction must also be resolved or an approved alternate verification route selected before source publication can be claimed.

## 2026-10-19 — Mainnet protocol broadcast gates enforced

Status: Slice 22 remains **78%** (`7/9`); the expanded roadmap remains **93.9%** (`154/164`). No protocol deployment transaction was submitted.

- Hardened the actual protocol deployment command so mainnet cannot rely on the confirmation phrase alone.
- Before its first transaction, it now requires the frozen plan to match protocol/environment/chain, deployer, Safe, timelock, `300` second policy, pending nonce, all nine predicted addresses, five contract creation/runtime hashes, and ERC1967 proxy hashes.
- Added a mandatory independent approval artifact requiring at least one named external auditor, explicit approval, and zero unresolved critical or high findings.
- Added a structurally non-broadcasting `--check-only` mode. It does not require or accept the deployment confirmation path and exits before the first deployment function is called.
- Verified the safe gate path against current mainnet state: it correctly stops with `Independent mainnet audit approval is absent`. Contract tooling type-check and repository whitespace validation passed.
- A direct test using the real broadcast confirmation command was not performed because it could become destructive if a gate were accidentally bypassed.

### Action required from owner

- Obtain the genuine independent audit report and approval artifact. Do not create a placeholder or self-approval merely to satisfy the gate.

## 2026-10-19 — Full mainnet-fork protocol rehearsal passed

Status: Slice 22 remains **78%** (`7/9`); the expanded roadmap remains **93.9%** (`154/164`). No transaction was sent to mainnet.

- Added a mainnet rehearsal mode that refuses every non-loopback RPC, writes only `deployments/mainnet/rehearsal-manifest.json`, uses a separate private journal, bypasses no frozen-plan checks, and cannot overwrite the production manifest.
- Ran all nine planned deployment transactions against a local fork of chain `4663`: four implementations, four initialized ERC1967 proxies, and PoolQuoter deployed successfully.
- The rehearsal consumed `9989099` gas in total. At the observed live gas price of `20320000` wei, the indicative fee is `202978491680000` wei (`0.00020297849168` ETH); a 2x gas-price buffer is `0.00040595698336` ETH versus the current deployer balance `0.000503978460834706` ETH.
- Verified five contracts, all nine receipts, gas/fee totals, runtime hashes, four ERC1967 implementation slots, integration addresses, and the PoolFactory role on the fork.
- Confirmed every deployed rehearsal address exactly matches the frozen nonce-327 plan.
- Corrected the manifest verifier so it reports the actual number of explorer source checks instead of a hardcoded count. Rehearsal source count is correctly zero because source publication is pending.
- Stopped the local fork after verification. Mainnet state was unchanged.

### Action required from owner

- Current balance covers the measured deployment fee with approximately a 2x gas-price buffer, but adding a small additional native-gas reserve before production broadcast is recommended.
- The remaining hard blocker is still a genuine independent audit approval with zero unresolved critical/high findings.

## 2026-10-19 — Reproducibility and security review evidence recorded

Status: Slice 22 remains **78%** (`7/9`); the expanded roadmap remains **93.9%** (`154/164`). Mainnet broadcast remains blocked.

- Recorded the owner-provided 57-test/13-suite contract result, five-contract storage check, circuit architecture check, seven withdrawal vectors, protocol vectors, and testnet recovery rehearsal at block `138777209` as a structured non-approval evidence artifact.
- Recorded the security review observations for Vault solvency, exact transfers, nullifier ordering, upgrade separation, Shielded LP Manager fund-return restriction, and the 13-input withdrawal circuit boundary.
- Preserved `ZKBlastVault` constructor-input mismatch as open finding `ZKB-REPRO-001` with unrated severity; it continues to block mainnet Shielded custody.
- Preserved Shielded LP Manager as not approved for real custody until a signed external report explicitly covers it.
- Did not create `audit-artifacts/mainnet/approval.json`: the supplied report explicitly states that a signed report from an identified external auditor is still pending, and the current working tree contains uncommitted changes beyond base commit `1eed6bb10285526b052ded903115af6b5e60a202`.

### Action required from owner

- Ask the external auditor to identify the exact reviewed commit or immutable artifact hashes, provide their identity, date, signature or verifiable attestation, severity classification for `ZKB-REPRO-001`, and an explicit conclusion covering core contracts, circuits, and Shielded LP Manager.

## 2026-10-19 — Core mainnet deployed under explicit owner risk acceptance

Status: Slice 22 is **89%** (`8/9`); the expanded roadmap is **94.5%** (`155/164`). Core public-pool contracts are live on mainnet; Shielded custody remains inactive.

- Recorded the owner's explicit decision to proceed without a signed independent audit as a scoped, plan-hash-bound risk acceptance covering only PoolRegistry, PoolFactory, SwapRouter, PositionManager, and PoolQuoter.
- Kept ZKBlastVault, Shielded LP Manager, withdrawal adapter/circuits, and real shielded custody explicitly outside the waiver because `ZKB-REPRO-001` remains open.
- Passed the final release gate at nonce `327`, then broadcast all nine planned mainnet transactions successfully.
- Deployed the exact frozen implementation/proxy addresses, produced `deployments/mainnet/manifest.json`, and verified five contracts, nine successful receipts, runtime hashes, four ERC1967 implementation slots, integration mappings, and PoolFactory authorization directly on chain `4663`.
- Total deployment gas was `9989099`; total fee was `203925951528000` wei. Deployer nonce advanced to `336` and remaining native balance was `0.000300052509306706` ETH immediately after verification.
- Explorer source verification remains pending and is reported honestly as zero verified source addresses.
- Added and passed a non-destructive live mainnet recovery rehearsal at block `92692032`, covering all core runtimes/proxies, Safe `2-of-2`, timelock `300` seconds and roles, schema boundary, and runbooks with zero chain mutations.
- Mainnet readiness now reports **8/8 ready** under the explicit owner-waiver policy with Shielded custody excluded.

### Action required from owner

- To make swaps executable, fund an operational wallet on chain `4663` with both WETH and USDG. Current checks found no WETH on deployer, either Safe owner, or the Safe; only the second owner held `1 USDG`.
- Do not fund or activate Shielded custody yet. The next executable-market action is a Safe `2-of-2` transaction to create WETH/USDG, followed by owner-funded liquidity through PositionManager.
- Railway mainnet service activation remains a separate deployment action and still requires explicit approval under the standing deployment policy.

## 2026-10-19 — Parallel mainnet Railway services activated

Status: Slice 22 is **100%** (`9/9`); the expanded roadmap is **95.1%** (`156/164`). Mainnet web, API, and indexer services are live in parallel with the existing testnet stack.

- Created and deployed isolated Railway services `web-mainnet`, `api-mainnet`, and `indexer-mainnet` in project `practical-ambition` without replacing the existing testnet services.
- Published mainnet web at `https://web-mainnet-production-2757.up.railway.app` and mainnet API at `https://api-mainnet-production-a2d5.up.railway.app`; the indexer remains private with no public domain.
- Configured persistent service-specific Railpack build/start commands for the monorepo and kept all deployer, governance, upgrader, Safe-owner, Supabase, and RPC secrets out of the web service.
- Corrected API startup so pool-specific operations monitoring is optional until a real mainnet pool manifest exists; malformed configured market data still fails closed.
- Verified the mainnet API health endpoint, environment `mainnet`, chain ID `4663`, and all five manifest-backed contract addresses.
- Verified the web root, Swap page, Pools page, and same-origin `/api/v1/config` proxy return successfully with chain `4663` and five contracts.
- Scanned the rendered HTML and downloaded browser JavaScript chunks: no Supabase URL/key, service-role identifier, Alchemy endpoint, RPC variable, or WSS endpoint was present.
- Verified the private indexer completed a real synchronization cycle on chain `4663` at finalized block `92691516`.
- Confirmed the existing testnet web/API remain reachable as chain `46630` and all three testnet services retain successful active deployments.

### Action required from owner

- Open the mainnet web URL, connect a wallet configured for chain `4663`, and confirm the displayed network and five contract addresses. Wallet connection and browsing can be tested now.
- Swap, add-liquidity, remove-liquidity, and position lifecycle testing still requires a registered mainnet pool with real liquidity. Fund the operational wallet `0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9` with native gas plus WETH and USDG before authorizing pool creation and liquidity transactions.
- Do not activate Shielded custody. It remains intentionally unavailable until the outstanding reproducibility finding and independent Shielded review are resolved.

## 2026-10-19 — First mainnet WETH/USDG pool created

Status: Slice 23 is **75%** (`3/4`); after adding this executable-market slice, the expanded roadmap is **94.6%** (`159/168`). Pool creation and publication are complete; initial liquidity remains blocked only by missing wallet assets.

- Added a reusable mainnet-only market workflow that validates chain `4663`, canonical WETH/USDG runtime code, Safe owners/threshold/nonce, local versus on-chain EIP-712 hashes, two ordered owner signatures, predicted pool address, and full Safe execution before broadcast.
- Simulated and then executed Safe transaction hash `0x983a839d85f9eaeffc68e0f2aa321622b72ff72f70f6a2202fd8f46f6e3d5315` with both approved Safe owners.
- Created the canonical 30-bps DAMM WETH/USDG pool at `0x04235f09dBf73E83fE6a49E9235851bb53eB8f71` through PoolFactory and verified its registry membership, factory, ordered assets, fee, runtime bytecode, and empty initial accounting.
- Confirmed transaction `0x10a2cad29f9df79dc86a7e377cc1a5102360ed9aabbb7d231722e22a01c23223` succeeded at block `92708797`, consuming `1542883` gas with total fee `31616758436000` wei.
- Published the full public record at `deployments/mainnet/market.json`; the ignored private recovery journal contains no raw signer keys.
- Validated the pool directly on chain before atomically registering verified WETH, USDG, and the pool in `zkblast_mainnet`.
- Confirmed the live mainnet API and the web same-origin proxy both expose exactly one WETH/USDG pool. No Railway redeployment was necessary because the running services read the isolated mainnet database dynamically.
- The pool intentionally remains empty: reserves and total shares are zero. No fabricated balance, mock liquidity, or false acceptance swap was recorded.

### Action required from owner

- Fund operational wallet `0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9` on chain `4663` with both canonical WETH and USDG plus additional native gas. Current balance is approximately `0.000387981422176193 ETH`, `0 WETH`, and `0 USDG`.
- Choose the initial WETH/USDG liquidity amounts. Both assets must be present in the same operational wallet; the protocol cannot seed genuine liquidity with only the `1 USDG` currently held by the second Safe owner.
- After funding, authorize the initial add-liquidity and bounded acceptance swap. The web can display the pool now, but swaps must remain unavailable until both reserves are nonzero.

## 2026-10-19 — Mainnet Stock Token pool parity completed

Status: Slice 23 is **71%** (`5/7`); after expanding the slice for Stock Token parity and strict web environment copy, the overall roadmap is **94.2%** (`161/171`). Five Stock Token pools are live and registered; initial liquidity and the approved web release remain pending.

- Selected exactly the five Stock Token markets that have executable testnet pools: AMD, AMZN, NFLX, PLTR, and TSLA. Each mainnet address was taken from the validated Robinhood Stock Token catalogue, not from its chain-46630 faucet mapping.
- Validated runtime bytecode, exact symbol, exact name, 18 decimals, and positive total supply for all five canonical chain-4663 assets before preparing any transaction.
- Added a resumable Safe `2-of-2` workflow with deterministic pool prediction, sequential nonce handling, EIP-712 hash agreement, two ordered signatures, per-pool simulation, receipt journaling, registry verification, immutable token/fee checks, and empty-accounting checks.
- Created and verified five 30-bps DAMM/USDG pools through Safe nonces `1` through `5`: AMD `0x6f6451971bc3640B122fB8200582BddB0Bf2364b`, AMZN `0xa4E4D3254a41C460f9522B9B3FA78413F46DF53F`, NFLX `0xfC81e903218c5C50486f750D44D54d8a002d2FB4`, PLTR `0xBDB9D62e9604F3A6ea48f6F24B8cF1693dE27a28`, and TSLA `0x99A9d62B9e1730F3E1E9230e5F1433Ffa99c6e20`.
- The five transactions consumed `7543409` gas and `154326075840000` wei total fees. Safe nonce is now `6`; deployer native balance after verification is approximately `0.000114109675030706 ETH`.
- Registered all five validated assets and pools in `zkblast_mainnet`. Their external routes are intentionally `observed`, not `validated`, because every reserve and total share remains zero; the database constraint prevents an empty pool from being advertised as executable.
- Confirmed the live mainnet API now exposes six protocol pools total: WETH/USDG plus AMD, AMZN, NFLX, PLTR, and TSLA against USDG. Five Stock Token catalogue rows point only to execution chain `4663` and the corresponding mainnet pool.
- Audited network-sensitive web copy and replaced hardcoded testnet labels, chain `46630`, testnet-only empty/error states, footer text, market filters, trade labels, and unavailable Shielded copy with active API environment/chain values.
- Scanned public mainnet API config, pools, swaps, positions, metrics, and market responses; none contains `testnet`, `46630`, `ZKTA`, `ZKTB`, or `faucet` data.
- Contract and web focused type-checks pass. The mainnet web code change has not been deployed because the standing policy requires explicit Railway approval for each release.

### Action required from owner

- Explicitly approve one `web-mainnet` Railway deployment to publish the environment-aware copy changes. No API/indexer deployment or secret change is required for this UI-only release.
- To activate trading, fund the operational wallet with each desired Stock Token plus USDG and native gas, then choose initial liquidity amounts. Until nonzero liquidity is verified, the five routes correctly remain observed/non-tradable.
- The deployer now has approximately `0.000114109675030706 ETH`; top it up before additional governance pool creation or other relayed Safe transactions.

## 2026-10-19 — Mainnet market catalogue expanded to 101 entries

Status: Slice 23 is **75%** (`6/8`); the expanded roadmap is **94.2%** (`162/172`). The complete market catalogue is ready, and eight protocol pools are live; the Railway release and initial liquidity/E2E remain pending.

- Imported 101 active, previously validated Robinhood Stock Token records into `zkblast_mainnet` with USDG pairing and curated logo metadata. The official upstream refresh was not accepted because its TLS certificate is expired; TLS verification was not disabled.
- Added a resumable, balance-aware Safe batch workflow so future pool creation validates bytecode, symbol, decimals, positive supply, Safe owners/threshold/nonce, deterministic address, simulation, receipt, registry membership, immutables, and empty accounting before publication.
- Created MSFT/USDG at `0x2AAfE4d1fA1b1C75951D5fD325E82B420558CA48` in transaction `0xcc89a23438048922a9319a1e6bab7ce7b9119a5a733ddd64310c6ac3533b46a9` and META/USDG at `0xef6892976b7E69890986746583909Ce0Cc9dfa95` in transaction `0x3a6f92aa6c6172e2b90689d30449560d955108110a4a23158703b9e7fae20413`; each used `1508693` gas.
- Registered seven verified Stock Token pools in the mainnet database. With WETH/USDG, the protocol now has eight mainnet pool contracts. All empty Stock Token routes correctly remain `observed` until real liquidity exists.
- Expanded the API market page limit and web requests to return the full 101-entry catalogue rather than silently dropping the 101st unclassified market.
- Reused one database-driven pair-logo component across the hero pool rail, landing Markets, Pools, Swap, Positions, Analytics, external-liquidity panel, and pool detail. Base and USDG/WETH/ETH logos render as overlapping white circles; missing/unvalidated URLs use an SVG fallback.
- Web and contract type-checks and web lint pass. No Railway deployment was performed without a fresh explicit approval.

### Action required from owner

- Top up deployer `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B` with native ETH on chain `4663`. Current balance is `0.000052717939474706 ETH`; the RPC requires at least `0.00007567224 ETH` available even for the next transaction's EIP-1559 fee reservation. For all remaining 94 Stock Token pools with a practical safety buffer, target a deployer balance of at least **0.004 ETH**.
- After top-up, authorize continuing the resumable batch. The next queued pool is GOOGL/USDG; no completed pool will be recreated.
- Explicitly approve deployment of both `api-mainnet` and `web-mainnet` on Railway when ready. The API limit change and cross-page logo UI require those two releases; the indexer does not need redeployment for this change.
- Real swaps still require the selected pools to receive genuine Stock Token and USDG liquidity. Catalogue visibility alone does not make an empty route tradable.

## 2026-10-20 — Pons mainnet trending catalogue imported

Status: Slice 23 is **77.8%** (`7/9`); the expanded roadmap is **94.2%** (`163/173`). Ten Pons markets are live as validated catalogue records; Railway release and genuine ZKBLAST liquidity/E2E remain pending.

- Researched the official Pons Launchpad trending board and captured the ten entries above the strict USD 1 million threshold: PONS, RAETO, ORBIO, BOW, ROBINCAT, HYDX, PARE, HARMONIC, HMM, and DELTA.
- Validated every token directly on chain `4663`: runtime bytecode, exact symbol, nonempty name, decimals, positive total supply, known V1/V2 factory membership, graduation state, original pool identifier, and original quote asset.
- Preserved the actual source pairs instead of rewriting them: PONS/HMM/DELTA use WETH, ROBINCAT uses USDG, RAETO/HYDX/PARE/HARMONIC use native ETH, ORBIO uses NVDA, and BOW uses SPY.
- Validated all ten logo URLs as bounded image responses, stored approved base logos and quote-logo metadata, and exposed a reusable `quoteLogoUrl` field for pages where there is no ZKBLAST pair candidate.
- Imported all ten records idempotently into `zkblast_mainnet`. Only Pons WETH/USDG pools are represented as `observed`; native ETH and stock-paired launches retain provenance only. All ten correctly remain `canTrade=false` until a ZKBLAST route is independently validated.
- Added repeatable validation/import commands and the public evidence artifact at `data/mainnet-pons-trending.validated.json`.
- API lint/typecheck/build and all `27/27` tests pass; web lint/typecheck/production build pass with ten generated routes.

### Action required from owner

- Approve the pending Railway rollout for the connection-pool fix plus the new API `quoteLogoUrl` and web pair-logo rendering. Until deployed, the database records are live but the newest UI/API fields and wallet-login fix remain only in source.
- Do not expect swaps from these catalogue records yet. Making a Pons market executable in ZKBLAST requires a separately created and funded ZKBLAST pool using an available quote asset, followed by route validation and an E2E swap.

## 2026-10-20 — Ten Pons preferred pairs registered

Status: Slice 23 is **81.8%** (`9/11`); the expanded roadmap is **94.3%** (`165/175`). Pair discovery and live landing-state presentation are complete; Railway release and genuine funded-liquidity/E2E acceptance remain pending.

- Registered the preferred pair set as PONS/WETH, RAETO/ETH, ORBIO/USDG, BOW/USDG, ROBINCAT/USDG, HYDX/ETH, PARE/ETH, HARMONIC/ETH, HMM/WETH, and DELTA/WETH.
- Kept ETH launches bound to native ETH on Robinhood Chain mainnet (`chainId 4663`, zero-address native-asset representation); no Ethereum-mainnet asset and no silent WETH substitution is used.
- Expanded pair catalogue validation to accept ETH while keeping transaction-preparation endpoints restricted to validated ERC-20 USDG/WETH routes. Until the matching API release is deployed, native ETH remains represented by the market's canonical quote and Robinhood Chain metadata rather than a route-candidate row, preserving compatibility with the currently deployed API.
- Added an additive mainnet/testnet schema migration, applied and verified the mainnet migration, removed the temporary WETH-planned rows for native ETH launches, and verified the final database mapping idempotently without exposing an executable native route.
- API tests pass `27/27`; web tests pass `14/14`; API/web lint and type checks pass; the production web build completes with all ten routes.
- Replaced the ETH quote artwork across the importer, indexer catalogue, and reusable web pair-logo fallback with the owner-provided MetaMask image URL; verified HTTP 200 `image/jpeg`, synchronized all four native-ETH market metadata records, and confirmed the public API returns the updated URL inside metadata.
- Routed USDG/WETH/ETH artwork through a bounded, allowlisted, cached same-origin image endpoint so upstream hotlink behavior cannot expose a broken browser image; added white-circle shimmer states and retained the SVG failure state.
- Rebuilt Pipeline Terminal and Event Stream to prioritize indexed swaps and registered pools, then fill unused rows with protocol operating states derived from indexer metrics and deployed modules. No synthetic transaction hash, block number, commitment, or nullifier spend is presented as an onchain record.
- Replaced empty-event wording with registry/router/verifier/indexer states, and added loading shimmer to the pool rail and event stream. Web tests pass `14/14`; lint, typecheck, and production build pass, including the dynamic asset-logo route.
- Corrected the image gateway namespace from `/api/asset-logo/*` to `/asset-logo/*` so Next's backend `/api/:path*` rewrite cannot intercept it. Added a server-side `/auth-session` adapter that converts an expected backend `401` into a clean unauthenticated state without weakening `/v1/me` protection or exposing the backend hostname. Route regression coverage brings the web suite to `16/16`, and a cache-free production build publishes both dynamic routes in the manifest.

## 2026-10-20 — DLMM activation foundation completed

Status: Slice 24 is **37.5%** (`3/8`); after adding the explicit DLMM activation scope, the expanded roadmap is **91.8%** (`168/183`). Contract readiness and decimal-aware bin selection are complete; governed upgrades, pool creation, liquidity, and E2E acceptance remain.

- Verified the mainnet deployer top-up at `0.005434940530462432 ETH` on chain `4663`; governance remains Safe `2-of-2` at nonce `8`, with the configured 300-second timelock.
- Confirmed the live mainnet API exposes eight DAMM pools and zero DLMM pools. The prior deployment workflows hardcoded model `0` and bin step `0`, so the absence was deployment/configuration scope rather than missing router, quoter, position, API, indexer, SDK, or UI support.
- Added backward-compatible PoolFactory functions for explicit DLMM initial-bin creation and CREATE2 prediction. Existing DAMM and legacy DLMM interfaces remain unchanged; no storage variable was added.
- Added integer-only TypeScript math matching Solidity's fixed-point rounding, including human-price decimal normalization for 18-decimal WETH versus 6-decimal USDG, bounded nearest-bin discovery, and deviation reporting.
- Validated free public ETH/USD references from CoinGecko (`2412.33`) and Coinbase (`2409.70`); both independently resolve to initial bin `-7947` at a 25-bps bin step, with ten basis points or less representation deviation.
- Downloaded official Foundry `v1.8.5` into a temporary directory and verified its published SHA-256 before use. The full contract matrix passes `59/59`, the focused factory suite passes `8/8`, bin-math tests pass `4/4`, TypeScript checks pass, formatting is clean, and storage compatibility passes for all five upgradeable contracts.
- No testnet or mainnet broadcast was performed in this step.

### Action required from owner

- No additional gas top-up is needed for preparation; the current deployer balance is sufficient for the planned implementation deployment, governed upgrade, and pool creation.
- The next broadcast phase will require explicit approval after the Safe/timelock plan hash, target proxy, new implementation address, calldata, salt, delay, and estimated maximum fee are reported.
- Genuine WETH and USDG are still required in the LP wallet before DLMM liquidity and swap acceptance can be completed.

## 2026-10-20 — Governed DLMM upgrade plan and fork rehearsals complete

Status: Slice 24 is **50%** (`4/8`); overall roadmap is **92.3%** (`169/183`). Public testnet upgrade/liquidity acceptance and live mainnet activation remain outstanding.

- Added a concrete, hashed upgrade plan for proxy `0x202A08e43bb7C93a2f88dd225c80E8622b626aBd`, predicted implementation `0x94d340C329dCf495E7e87a0c35b72b8BF3fe8165`, deployer nonce `348`, Safe nonce `8`, and the existing 300-second timelock. The full calldata, salt, operation ID, bytecode hashes, fee limits, and preview pricing are in `deployments/mainnet/dlmm-upgrade-plan.json`.
- Added a resumable live executor with deploy/schedule/execute stages, an exact plan-hash confirmation, artifact and nonce validation, implementation bytecode verification including UUPS immutable references, fee reservation checks, private transaction journaling, completed-operation/implementation-slot checks, and public manifest receipt/gas/fee updates.
- Rehearsed the upgrade plus DLMM creation at mainnet fork block `93235006` using the actual two-owner Safe signatures. Verified early execution rejection, preserved registry storage, pool registration, bin step, and selected active bin. These receipts exist only on the local fork.
- Rehearsed the actual resumable executor independently with real signature generation, configured fee caps, repeated deploy/schedule/execute calls, and a premature execute attempt. Repeated stages reused the same receipts; no production manifest was changed. Upgrade stages consumed `4895273 + 96094 + 95865 = 5087232` gas on this fork.
- Reference selection now derives ETH/USDG from both ETH/USD and USDG/USD, checks provider disagreement and freshness, and recalculates the nearest decimal-aware bin. The final preview used ETH/USDG `2391.836377047061310899` and bin `-7950`; pool broadcast must fetch fresh references again.
- Nine mathematical/reference validation tests pass, including stale price, provider disagreement, depeg-range, and wrong-pair rejection. Contract/ABI type checks pass and all 11 generated ABIs match the rebuilt artifacts. The unchanged Solidity baseline remains 59 passing tests with five-contract storage compatibility.
- No public-chain transaction or Railway deployment occurred. The final plan reserves at most `0.000422184 ETH` across implementation deployment, schedule, and execute. Pool creation and liquidity have separate fees.

### Owner handoff

- Review the concrete upgrade plan and rehearsal evidence before authorizing its live broadcast. The frozen plan hash is `0xe60dcabde8e737b4f1ab5440c6bc44bdaa3f7666205feb92891541df81120918`.
- No secret value is missing for preparation. Existing mainnet/testnet keys remain in their ignored environment files; local rehearsal RPC configuration is command-scoped.
- Public testnet DLMM activation and its liquidity acceptance remain mandatory roadmap steps before the live mainnet upgrade; the fork rehearsal does not mark those steps complete.

## 2026-10-20 — Public testnet DLMM deployed and funded

Status: Slice 24 is **62.5%** (`5/8`); overall roadmap is **92.9%** (`170/183`). Public onchain liquidity acceptance has passed. The sixth task remains unchecked because Railway release and manual browser acceptance have not yet occurred.

- Deployed PoolFactory implementation `0xE49b9c6B8aAe69B017550C688310783168D2b48A` and upgraded stable testnet proxy `0x4FC2dA2feb00a905DFAF39a7e402943250e0221E`. Implementation transaction: `0x43d6a68e646457e5e689d7cc9151aa29e94ae434c5ae2f728b6146dcf6930498`; upgrade transaction: `0x8efad440ca490a3d8acd85d53262077242d7ff403483051fea3465f155e014cb`.
- Created WETH/USDG DLMM `0x0d996C5ACD383a951b5361e11C37F522d15aB839` at block `139230795`, fee 30 bps, bin step 25 bps, initial active bin `-7950`. Pool transaction: `0x8b07ebfe3150e6794fbc508608c0d8d1f4e139e8b1f47bc36944d135b27ff01c`.
- Wrapped exactly `0.0001` native testnet ETH into the existing chain-46630 WETH contract; no mainnet asset was used. Funded bins `-7951`, `-7950`, and `-7949` through Position Manager, producing positions `2`, `3`, and `4` owned by the configured governance wallet.
- Increased position `4`, performed a real `0.000025 WETH` routed swap crossing from bin `-7950` to `-7951`, and removed ten percent of position `4` with reserve-derived 1% output bounds. Swap transaction: `0x090048266d80ab59a83ae1573bb2d5e2c2c34c28ce913501f2c251c73654f553`; removal: `0x311546e454f69da4d300ec4af81a4a30059441ec41ce8cba279ac620d1215451`.
- All 13 transactions succeeded, consuming `8603837` gas and `86038370000000` wei (`0.00008603837 ETH`) in execution fees. The wrapped amount is an asset conversion and is separate from these fees.
- Validated registry membership, runtime, token identity/ordering/decimals, active-bin reserves, current LP ownership/shares, and canonical receipt/block hashes before atomically registering the pool, swap, existing-user positions, and transaction ledger in `zkblast_testnet`. Backfilled 22 validated protocol/receipt events across 13 blocks using the separate `dlmm-acceptance` checkpoint.
- Confirmed the public Railway pool endpoint already returns the new DLMM pool through its database read path. Found and fixed a separate position endpoint failure: the shared ERC-20 ABI omitted metadata selectors `symbol()` and `decimals()`. The new metadata interface is generated from its own Solidity artifact, leaving deployed core bytecode unchanged. Direct RPC-backed checks now return all three real DLMM positions and the three funded bins.
- Added a registry-validated bin read endpoint, contract-bounded bin selection, and live active-bin defaults. Added one reusable protocol swap/liquidity workspace to both pages and replaced the landing bin placeholder with actual reserve/share data. The liquidity flow computes the paired deposit and a 1% minimum-share bound from live reserves.
- Extended the indexer to track registered pool addresses dynamically and classify DLMM liquidity/active-bin events. API tests pass `29/29`, web tests `16/16`, and indexer tests `10/10`; API/web/indexer builds, type checks, lint and web architecture checks pass.
- Full receipt/gas evidence is published in `deployments/testnet/dlmm-market.json`; the resumable private journal remains ignored by Git. No Railway release or mainnet transaction was sent in this step.

### Action required from owner

- Approve one testnet release batch for the web, API, and indexer services so the corrected metadata ABI, DLMM bin endpoint, protocol workspace, and dynamic pool indexing become public. The currently deployed position endpoint still returns HTTP 500 until the API fix is released.
- No additional environment secret or wallet top-up is required for this completed testnet activation. Wallet `0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9` owns the three LP positions.
- Complete manual browser acceptance after that release, then proceed to the reviewed mainnet upgrade plan. Mainnet WETH/USDG liquidity still requires genuine LP assets.

## 2026-10-20 — Authorized testnet Railway DLMM release complete

Status: Slice 24 remains **62.5%** (`5/8`), overall **92.9%** (`170/183`). Release and HTTP acceptance are complete; the combined sixth task still requires manual browser wallet acceptance.

- Owner authorized one batch for testnet only. All three deployments reached `SUCCESS`: web `9bde99cc-a626-48e8-a3e0-2b6c1ddcd377`, API `a93d4be7-2258-48bd-80ca-9793394cf153`, indexer `39fde818-642b-432c-a00e-ccff80547d52` in project `practical-ambition`. Mainnet services were not deployed and no new chain transaction was broadcast.
- Public testnet `/swap` and `/pools` return HTTP 200 and serve the new Public protocol pools workspace bundle. Landing and positions pages also return 200.
- Live bin endpoint returns active bin `-7951` and funded bins `-7951`, `-7950`, `-7949`. Owner-scoped positions now return HTTP 200 with three DLMM positions instead of the prior metadata-ABI failure.
- Read-only DLMM quote for `1000000000000` raw WETH returns `2381` raw USDG. Liquidity preparation without an explicit bin returns live bin `-7951`; no approval or transaction was submitted during smoke testing.
- Same-origin WETH, USDG and ETH logo routes all return HTTP 200 image content. Anonymous `/auth-session` returns 200 with `authenticated: false`; this does not certify signed wallet login.
- Testnet config remains chain `46630`; the untouched mainnet config remains chain `4663`. No environment values were printed or modified.
- New indexer logs confirm `synced` on chain `46630`, starting at historical checkpoint `137437571`. It is not yet caught up to the DLMM creation block `139230795`; the separate validated DLMM acceptance backfill already supplies those events. Do not treat primary indexing as real-time yet.

### Action required from owner

- Open `https://zkblastweb-production.up.railway.app`, refresh the browser, connect/sign in on chain `46630`, select WETH/USDG DLMM in the Public protocol pools section on Swap/Pools, and execute a small swap plus add/remove liquidity. Verify receipts and Positions after each action.
- Wallet `0x2E8ca95e429F34E6e876E078DCd8E51eB31645B9` owns the existing three DLMM positions; another wallet will show its own positions only. Liquidity requires both testnet WETH and USDG plus native testnet ETH for gas.
- No new secret/environment value or deployment approval is required for this completed batch. Keep mainnet activation separate until testnet manual acceptance passes.

## 2026-10-20 — Mainnet service parity release

The owner requested the corresponding mainnet release. Slice 24 remains **62.5%** (`5/8`), overall **92.9%** (`170/183`): service publication does not complete the outstanding onchain DLMM activation tasks.

- Released only `web-mainnet` (`ff0dc2dc-5b09-4a4f-9aaa-ca3725351751`), `api-mainnet` (`aac7f66b-ea68-4c9d-ae4e-d0c10460dc99`), and `indexer-mainnet` (`95450fa6-245b-4503-81b3-4ecfac691d61`). All three reached SUCCESS. Landing, swap, pools and positions return HTTP 200; swap/pools serve the new Public protocol pools workspace bundle. Testnet remains reachable with environment `testnet`, chain `46630`.
- Verified service configuration uses mainnet chain `4663`, schema `zkblast_mainnet`, and the mainnet manifest. No deployer/governance/upgrader key is configured on these services. No variables were modified or secret values printed.
- Public API smoke checks pass: configuration, eight DAMM pools, owner positions, anonymous session, and WETH/USDG/ETH logo routes. There is no mainnet DLMM pool yet. No testnet pool is copied into mainnet.
- Mainnet indexer logs confirm chain `4663` and historical checkpoint `92736954`; it remains behind the current chain and is not claimed to be real-time.
- Read-only onchain checks confirm deployer nonce `348` and Safe nonce `8` still match the frozen upgrade plan. Deployer holds `0.005434940530462432 ETH`, `0.002 WETH`, and `2.164607 USDG`; governance wallet holds no WETH/USDG. These balances were not spent.
- No upgrade, pool creation, token approval, liquidity transfer, or swap was broadcast. The reviewed upgrade preserves Factory proxy `0x202A08e43bb7C93a2f88dd225c80E8622b626aBd`, targets implementation `0x94d340C329dCf495E7e87a0c35b72b8BF3fe8165`, uses the existing 300-second timelock, and caps its three upgrade-stage execution fees at `0.000422184 ETH`. Pool creation and LP funding are separate operations.

### Remaining owner decision

- Confirm the concrete mainnet upgrade plan and the LP funding amount before signing/broadcast. Frozen plan hash: `0xe60dcabde8e737b4f1ab5440c6bc44bdaa3f7666205feb92891541df81120918`.
- Complete the testnet browser swap/add/remove acceptance first. There is no missing environment secret for preparation and no top-up required merely to release the services.

## 2026-10-20 — Mainnet Factory upgrade executed with five-minute timelock

Owner explicitly approved the frozen mainnet upgrade plan, 300-second timelock, and `0.000422184 ETH` upgrade fee cap, and selected PONS/USDG for the initial mainnet DLMM pool. Upgrade subtask is **100%**; Slice 24 remains **62.5%** (`5/8`) and overall **92.9%** (`170/183`) because its combined mainnet task also requires pool creation, and manual testnet browser acceptance remains unconfirmed.

- Implementation deployment `0x426e8221eb42bf6aed1a95c45be73b84a72a8f21d032feda3cd7196f42ab3fed`, block `93260545`, gas `4905979`, fee `98325631118000` wei.
- Safe schedule `0xf2fe2ef2e4de1d5d2704fc26e12a7588c2b70f38ed169c59a8678b6e4da73511`, block `93260935`, gas `96629`, fee `1941469868000` wei. Timelock readiness timestamp `1792479813` was checked before execution.
- Safe execute `0x6ad5bd3d1e17836e5ff855fde375b649b6f644949110e3a6e3f0a831c44b68f3`, block `93264056`, gas `96081`, fee `1929882966000` wei.
- Verified stable proxy `0x202A08e43bb7C93a2f88dd225c80E8622b626aBd` now points to `0x94d340C329dCf495E7e87a0c35b72b8BF3fe8165`; timelock operation is done. Total `5098689` gas and `102196983952000` wei (`0.000102196983952 ETH`), within cap. Manifest updated with all receipts and totals; explorer verification remains pending.
- Initial schedule attempt stopped before broadcasting because mainnet owner-key placeholders were empty. Reused the existing testnet signer keys only in memory, as previously requested by owner, after checking both are actual mainnet Safe owners. No key was copied to another env file, stdout, or Railway.
- PONS token `0x39dBED3a2bd333467115dE45665cC57F813C4571` reports symbol PONS and 18 decimals on chain 4663. Deployer and governance wallets both have zero PONS. No pool creation, token acquisition, liquidity approval, or liquidity transfer occurred.
- Owner requested minimum funding but has not specified a numerical acquisition cap/source/slippage. Proposed explicit bounds: at most `0.00001 WETH` to acquire PONS, maximum `1%` swap slippage, and at most `0.03 USDG` alongside the acquired PONS for initial LP. These are proposed limits, not an executed quote or liquidity receipt. Validate route, current price/bin and pool-creation fees before broadcast.
- No Railway redeployment occurred during this upgrade. Running services use the same stable proxy; their bundled manifest still predates the implementation metadata update.

### Owner action

- Confirm the proposed PONS acquisition/LP limits or send PONS directly to deployer `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B` and specify the allowed LP amounts. Until genuine PONS is available and the pool is funded, PONS/USDG DLMM is not available for web transactions.

## 2026-10-20 — Mainnet PONS/USDG DLMM funded and available through web

Status: Slice 24 **75%** (`6/8`); overall roadmap **93.4%** (`171/183`). The mainnet Factory upgrade/pool-creation task is checked complete. The combined liquidity/swap/web-acceptance task remains open: funding is real and complete, but no ZKBLAST pool swap or manual browser signature is claimed.

### Onchain outcome

- Owner approved at most `0.00001 WETH` for PONS acquisition, 1% slippage, and at most `0.03 USDG` for LP. Spent exactly `0.00001 WETH`, received `0.08830818692091484 PONS`; actual output exceeded minimum `0.087425105051705691 PONS`. Purchase transaction `0x5e298ed87541942b4cfa9d7331bd15827adf41921124bf9e6442ce7beb7c7931`.
- PONS had an existing balance of `2.652668036895328749` at preflight (changed externally since the prior turn). Funding uses only 98% of the new purchase balance delta; the pre-existing balance was not used. Deposited exactly `0.086542023182496541 PONS` and `0.023194 USDG`.
- Created mainnet pool `0x0a0163fD4AcF6ab403bf22DAC0c91D8510783919` through the two-owner Safe; transaction `0xa3073e8b12674d800eabb54d8eb350565eb4fcb4bd02d8c72ecf396565bf5f8f`, block `93272108`. Model DLMM, fee 30 bps, bin step 50 bps, initial active bin `-5804`.
- Selected the initial bin using current canonical PONS/WETH V3 spot, a five-minute source-pool TWAP divergence check, and fresh independent ETH/USDG references. The decimal-normalized bin price was within 12 bps of the preflight reference. The wider 50-bps bin step accommodates the 18/6-decimal PONS/USDG price within contract bounds.
- Funded bins `-5805`, `-5804`, `-5803` with LP positions `1`, `2`, `3`, owned by deployer `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B`. The center bin received half the PONS allocation and each adjacent bin one quarter. LP transactions are recorded in `deployments/mainnet/pons-dlmm-market.json`.
- Twelve successful transactions consumed `3400305` gas and `68169771514000` wei (`0.000068169771514 ETH`) in execution fees. These are separate from the earlier Factory upgrade cost. All WETH/source-router and PONS/USDG/PositionManager allowances were checked to be zero afterward.

### Database, web and evidence

- Validated registry membership, runtime presence, factory, model, token identity/order/decimals, active-bin funding, three LP ownership/share records, and each receipt against its canonical block before atomically inserting assets/pool/transaction records and the executable PONS/USDG route into `zkblast_mainnet`.
- Preserved the observed external PONS/WETH source route; added a separate validated `zkblast_dlmm` USDG route. PONS catalogue now reports `canTrade=true`, quote USDG, and approved PONS/USDG logos. No synthetic user was created; database LP links are inserted only for an already registered wallet, and the owner endpoint independently reads actual onchain positions.
- Public mainnet API returns the registered DLMM, all three funded bins, and all three owner positions. Both swap directions return successful quotes: `0.001 PONS → 0.000267 USDG`; `0.001 USDG → 0.003719788378739376 PONS` at smoke-test time. The PONS market-card quote and liquidity preparation endpoint also return HTTP 200 on chain 4663.
- Backfilled 12 canonical protocol/receipt events across the 12 receipt blocks with separate consumer `pons-dlmm-acceptance`; the primary historical indexer checkpoint was not advanced artificially and is still not claimed to be real-time.
- Added resumable stage scripts with bounded approvals, deadlines, budget checks, balance-delta accounting, simulation before broadcast, receipt reuse and ignored private journaling. Separated source validation/purchase, transaction runtime, and pure funding-budget validation; configuration lives in reviewed JSON. Six funding-budget tests, ten indexer tests, TypeScript checks and indexer lint pass. No repeat web build or Railway release was needed.
- Mainnet web already reads the new records at `https://web-mainnet-production-2757.up.railway.app`. Testnet remains chain 46630 and was not changed. No environment secret was added, printed or sent to the browser. Explorer source verification for the new deployment is not claimed complete.

### Owner manual testing

1. Refresh the mainnet web and check chain 4663. In Swap, choose PONS/USDG DLMM in Public protocol pools; reverse direction to try `0.001 USDG` first, or use `0.001 PONS` in the forward direction. Request a fresh quote before signing.
2. This is deliberately tiny live mainnet liquidity, not a production-depth market. Do not use large trade sizes; failed transactions can still spend gas.
3. In Pools, choose PONS/USDG DLMM and add a small paired deposit using your wallet's genuine PONS/USDG plus native ETH for gas. Confirm approval spender and receipt details.
4. In Positions, a wallet sees only positions it owns. Initial positions 1–3 belong to deployer, not the governance wallet. A different wallet must create its own LP position before testing partial removal. Refresh after the receipt confirms.
5. Report the transaction hash if login, quote, approval, swap, add/remove, or owner-scoped positions fail. No additional env value or immediate Railway redeploy is required.

## 2026-10-20 — Experimental Shielded mainnet activated and released

Slice 26 **87.5% (7/8)**; overall **93.0% (185/199)** by roadmap checkboxes. Remaining slice task: owner-signed browser acceptance/recovery using the live web. Slice 25 remains **87.5% (7/8)**; operator CLI acceptance is not substituted for owner browser acceptance.

### Owner authorization and trust boundary

- Owner explicitly superseded the independent-ceremony-first choice with fresh single-operator experimental mainnet setup and accepted the risks. Independent ceremony/review is **not completed** and no approval/audit artifact was fabricated.
- Approved cumulative gas ceiling **0.001 ETH** and one **1 USDG** deposit-withdrawal acceptance; then explicitly approved one mainnet-only Railway batch. No testnet deploy, Shielded LP, shielded swap or unrelated asset funding was included.
- Experimental risk notice and explicit deposit acknowledgement are visible in the web. One-USDG denomination is not an aggregate custody cap, and tiny anonymity sets do not provide a practical privacy guarantee.

### Setup, contracts and actual acceptance

- Fresh phase-1/phase-2 setup isolated in ignored `packages/circuits/target/mainnet-beta-withdraw-v1`; not a reuse/relabel of testnet keys. Entropy generated in memory, not printed/persisted by the runner; destruction cannot be proved. Final key verified against R1CS/phase-1 and a mainnet-context proof with 13 public inputs verified locally.
- Public prover release `/zk/mainnet/withdraw-v1-beta-871c729dadd4.json`, pinned SHA-256 `23ccc1a80adabb311ea743a6eb72838383c42b573761807dd5ddc45bdb21049f`. It explicitly declares `experimental-single-operator`, not independent review.
- Vault proxy `0xAAC59EBDE79E4e0eA0824BBE2562036b0fd5748A`, chain **4663**; registry/vault state uses UUPS; Safe threshold **2**, upgrade timelock **300 seconds**. USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals, denomination **1000000 raw**. Shielded LP manager remains zero/disabled.
- Deployment/configuration: **16 successful transactions**, **10,939,978 gas**, **0.000220171781618 ETH**. Every stage simulated before submission, gas capped cumulatively, signed transaction/hash journaled privately before broadcast, unexpected nonce/input changes halt resume. No automatic new transaction retry after revert.
- Actual acceptance: exact approval, **1 USDG** deposit, encrypted backup/restore using web note format, local/deployed-verifier proof checks, onchain withdrawal, spent nullifier, zero residual liability. USDG balance before/after **2.141413**; all acceptance USDG returned to deployer.
- Deposit `0xc6472e2fc47c16313262c44c70781ce22d1ae37bd58fd6ad0215874ef1a67238` (block **93335587**). Withdrawal `0xf726f83ada74ac23128bb6ee083a0bf80cf86eaa6474a21f9edeeee3d04b50a0` (block **93335596**).
- Combined **19 successful transactions**, **12,740,290 gas**, **0.000256974927722 ETH** total fees: **25.7%** of authorized gas ceiling. No further onchain fee was spent during checks or metadata reconciliation.
- Internal reproducibility check passes **11 contracts**, including exact creation inputs, artifact/runtime hashes and proxy construction/storage. A hash-field convention mismatch in the newly generated manifest was corrected locally; no redeployment was required. This is not an independent audit. New explorer source verification remains pending. Build emitted existing/generated-code Forge lint warnings; zero-warning audit certification is not claimed.

### Railway release and live checks

- Source upload snapshots explicitly excluded env, docs/evidence, Git directory, private journals/recovery keys, ceremony targets and build outputs. Web/mainnet variables verified to contain only server API target, not Supabase/RPC/private keys. API/indexer verified mainnet chain/schema and absence of operator private keys. Existing environment values were not copied to the frontend or changed.
- Mainnet batch: web `7e1dd6ff-6d64-4e86-9303-b78206de0e91`; indexer `f302e6a6-7a78-4b69-9498-a7f77de0275b`; initial API `b46d8c41-dceb-49ea-8d67-bc5d1ba6f9f6`.
- First live smoke caught the API response schema stripping `launchMode` and `proverRelease`; browser failed closed with deposits disabled. Added serializer fields and regression coverage, then one corrective **API-only** rollout in the same approved batch: `a479ef5e-a42a-49a0-9804-c3949df80f5a`. Web/indexer were not redeployed for this correction. All three final deployments are **SUCCESS**.
- Live API health, `/trade`, web-proxied configuration all HTTP **200**. Config returns correct beta mode, mainnet vault and 1 USDG denomination. Public manifest and **all three WASM/zkey/vkey assets** HTTP 200 and SHA-256 match. Actual-chain Merkle-path API returns HTTP **200**, matching receipt commitment, leaf 0 and depth 32. No secret/note/witness was sent to this endpoint check.
- Browser QA without a wallet confirms chain **4663**, experimental warning, real market catalogue, enabled **1 USDG** selection/Connect control after integrity verification, and no stuck prover-loading state. Screenshot: `docs/evidence/mainnet-shielded-beta/ui-ready.png`. No browser financial transaction was signed.
- Mainnet indexer startup logs contain successful sync and no error in the sampled lines; no claim that the historical checkpoint is fully caught up. Database read-only verification passes **20 backend-only RLS tables** in `zkblast_mainnet`, with cross-schema separation. No migration was needed.
- Compared Railway before/after metadata: latest deployment IDs of testnet web/API/indexer and keeper unchanged. Their pre-existing queued `NEEDS_APPROVAL` entries were not approved or acted on. Evidence: `docs/evidence/mainnet-shielded-beta/railway-before.json` and `railway-after.json`.

### Focused verification and owner action

- Config tests **10/10**; worker orchestration tests **3/3**; existing web suite **24/24** plus updated deposit targeted suite **3/3**; API public/config regression suite **6/6**. Local API tests required permission for loopback listener (initial sandbox EPERM was not an application failure). Config/web/API/contracts typechecks, web lint and architecture checks pass. One successful Solidity compilation; no repeat full contract/circuit test matrix or local Next production build. Railway built the deployed services.
- No new env value, Git init/commit/push, unrelated funding, or testnet mutation was performed by this work. Recovery passphrase/backups/private signed-transaction journal stay local, ignored and excluded from uploads.
- **Owner next:** hard-refresh `https://web-mainnet-production-2757.up.railway.app/trade?mode=shielded`, connect/sign in with own wallet on chain **4663**, ensure at least **1 mainnet USDG plus native ETH gas**, and follow `SHIELDED_MAINNET_BETA.md`. Download the **updated post-deposit backup with leaf index** before refreshing/closing; restore UI currently does not automatically resync a pre-deposit backup. Perform deposit/export/restore/withdraw and return transaction hashes only, never note/passphrase/private key.

## 2026-10-20 — Independent ceremony handoff and prover isolation

Slice 26 **37.5% (3/8)**; overall **91.0% (181/199)**, counted from roadmap task checkboxes. Slice 25 remains **87.5% (7/8)**. Independent ceremony, independent review, mainnet deployment and signed acceptance are not marked complete.

### Delivered

- Owner-selected path: independent ceremony and review first; no single-operator mainnet setup or reuse of testnet keys.
- Added `ZK_MAINNET_CEREMONY_HANDOFF.md`: coordinator/contributor/reviewer responsibilities, entropy confidentiality, authenticated public-artifact exchange, phase-1 provenance, contribution/beacon verification, reproducibility, known vault creation-bytecode finding and launch exclusions.
- Added allowlisted source-overlay generator and independent read-only inventory verifier. Final handoff contains **196 files**, including scoped source/tests, dependency lockfile, public testnet proving artifacts and review instructions. It is intentionally not a standalone installable complete monorepo; reviewer needs controlled read-only access to a credential-free checkout for complete builds.
- Final snapshot: `docs/handoff/zk-mainnet-afb5a72c603c`; full inventory identity `afb5a72c603cc610ad0eda2abbd6ae1a51679a4e3480991c16f2bb5b11d7481f`. All 196 file hashes/lengths verified. Earlier `38273859c092` folder is a superseded preparation snapshot, not the final handoff.
- Shareable local archive: `docs/handoff/zk-mainnet-afb5a72c603c.tar.gz` (~6.5 MiB); archive SHA-256 `9fde3fa158d5b082eed233fd7989450eab330a35e76b9fe039a93ca04218b36b`. This archive digest differs from the source inventory identity above.
- Testnet assets now live under `/zk/testnet/` with pinned manifest and WASM/zkey/verification-key hashes checked against existing architecture records. No `/zk/mainnet/` release or approval was fabricated. Legacy root assets remain for compatibility.
- New browser flow validates environment/chain and release path/hash, checks all proving assets before enabling deposits, rechecks at submission, and binds withdrawal note to current API network/vault. Worker checks asset bytes before proving and verifies generated proof locally. Legacy cached requests can use a pinned testnet compatibility path only for chain 46630; mainnet never falls back to testnet. Failed prover checks leave backup/withdrawal panels accessible where vault configuration exists.
- API forwards optional prover release metadata from deployment configuration; mainnet deployment schema still requires an explicitly pinned mainnet release when shielded contracts are configured. Trust labels are metadata, not independent signatures or audit evidence.

### Verification in this change

- Config tests **9/9**, worker orchestration unit tests **3/3**, existing web tests **24/24** pass. Worker unit tests use a stub prover; they are not cryptographic acceptance.
- Separately ran one real local `snarkjs.groth16.fullProve` using namespaced testnet WASM/zkey as byte arrays: local verification **true**, **13** public inputs. No note, witness, proof or secret was printed or added to the handoff.
- Config, web and API typechecks pass; web lint and architecture boundaries pass; `git diff --check` passes. No full Next build or repeat full contract/circuit suite was run. No signed browser or mainnet custody acceptance is claimed.
- Verified `docs/handoff` is ignored by Git. Limited exported-text scan found no matching private-key blocks, credential-bearing PostgreSQL URL or Alchemy key URL patterns. This is not a guarantee against all secret formats; manually review the allowlisted package before sharing.
- No onchain transaction, database mutation, new env value, Git commit/push, external upload or Railway release.

### Owner action

1. Select independent ceremony contributor(s)/coordinator and an independent contract/circuit reviewer; obtain scope, signing identity, availability and fees.
2. Review the final local archive and send it privately to those parties. Send the full inventory hash through a separate authenticated channel; do not send `.env`, wallets, notes, witnesses, contribution secrets or database/RPC credentials.
3. Reviewer should acknowledge the exact snapshot and known open vault reproducibility finding. Agree on phase-1 provenance, ceremony tooling, contribution sequence and beacon before ceremony execution.
4. No env action is required now. Do not redeploy merely to activate mainnet Shielded: release remains unavailable until independently reviewed artifacts, deployment approval and acceptance exist. Any Railway release of these local compatibility/security changes still needs explicit approval.

## 2026-10-20 — Shielded mainnet preparation

Slice 26: **25% (2/8)**. Overall task completion: **90.5% (180/199)** after adding eight explicit mainnet ZK tasks; previous Slice 25 remains **87.5% (7/8)**. This is task accounting, not a security certification.

- Added a deployment-schema gate requiring a pinned `/zk/mainnet/` prover release for shielded mainnet configuration. Core-only mainnet and existing testnet remain compatible.
- Added `pnpm check:shielded:mainnet`, a local read-only diagnostic that does not load credentials, call RPC, broadcast or write deployment evidence. Current result: 1/6 prerequisite checks pass; nonzero exit is expected while prerequisites are missing. Even all checks passing would not authorize custody.
- Config tests: 6/6 pass; config TypeScript passes. No repeated full build, Railway release, database mutation or transaction.
- Existing circuit artifacts explicitly declare `mainnetKeyDeployable=false` and a testnet-only single-device setup. Mainnet transcript and separate prover release are absent. No keys were relabeled and no mainnet custody was enabled.
- Browser worker still uses existing testnet asset paths. Network-bound loading and integrity enforcement remain open and must be completed before mainnet deposits are possible.

Owner action: arrange an independently contributed/reviewed mainnet ceremony, or discuss an explicitly development-only trust model before any proposed change of scope. No env value is needed now. Concrete broadcast/fee approval will be requested after a deployable artifact set exists. A risk waiver does not create missing ceremony artifacts or constitute an independent audit.

## 2026-10-20 — Unified Trade terminal implemented locally

Status: new Slice 25 **87.5%** (`7/8`). Roadmap total is now **93.2%** (`178/191`); the denominator grew by eight terminal tasks, not because earlier work was reverted. Slice 24 remains **75%** (`6/8`). Release and signed user acceptance remain open.

- Added `/trade` as the single primary trading destination, retaining Analytics/Docs. Swap/Pools/Positions/Shielded and pool-detail paths issue tested HTTP 307 redirects to the appropriate terminal mode/panel and preserve pool selection. Hero, catalogue and account-menu links now target Trade.
- Terminal uses hero-inspired panels with market browser left, selected pair/chart centre, action panel right, and owner positions/history/network activity below. Mobile uses a collapsible market browser and a stacked layout. Marketing footer is replaced by a compact terminal footer; native scrolling avoids nested smooth-scroll interference.
- Protocol and market providers share reads between panels. Instrument resolution matches token addresses, validates settlement chain and venue, and retains validated routes missing a duplicate protocol-pool record. Fee/block metadata not supplied by the API remains unknown rather than fabricated. Catalogue-only markets stay browse-only.
- Reused the protocol execution form for swap and liquidity, retaining approval/chain checks and live active-bin deposits. A selected market cannot be changed through controls while submission is busy; quotes expire at their actual deadline and are rejected after wallet/market context changes. Positions remain owner-scoped; username/profile access is retained in account history.
- Shielded controls follow the network vault configuration, not the selected market. Deposit/backup/withdraw components stay mounted so switching panels does not discard a local note. No shielded swap, new asset enablement or mainnet vault activation is claimed. Mainnet configuration currently reports no user-facing shielded asset; the UI honestly keeps those controls unavailable.
- Extracted shared AssetLogo, removed the URL-change reset race, checked cached `complete/naturalWidth`, bounded loading to 12 seconds, and retained white overlapping circles plus SVG failure fallback. Public GET requests also have a 20-second timeout. Chart requests reject stale selection responses and keep swap/oracle/reference histories separate; no chart values are synthesized.
- Web regressions pass **24/24**, including navigation, redirects, paused/cross-network routes, missing protocol-pool route retention and cached-image completion. Type/lint checks and the 350-line architecture boundary pass. Final production build passes after visual QA adjustments and compiles Trade plus the legacy redirects. The existing non-blocking Next.js ESLint-plugin warning remains.
- Browser QA used real public testnet data for the initial build and real public mainnet data for the updated local preview. Verified PONS/USDG selection, Swap/Liquidity/Shielded mode changes, search, no horizontal overflow at an actual **390×844 CSS-pixel viewport**, and live paired deposit `0.001 PONS → 0.000268 USDG` at bin `-5804`. The inspected settled desktop view had zero visible logo shimmers. Screenshots: `docs/evidence/trade-terminal/desktop.jpg` and `mobile.jpg`.
- No Railway deployment, contract transaction, database mutation, credential change, or new dependency was performed. Older unrelated working-tree changes were preserved. Local preview authentication is not certified: production SIWE origins remain bound to their deployed services.
- Compatibility check found the currently deployed trade-confirmation backend accepts DAMM base-to-quote receipts only. The unified form preserves that confirmation path when supported and explicitly distinguishes successful onchain receipts from saved account-history synchronization. DLMM and reverse-direction account-history persistence still require a separate backend enhancement; no unsupported confirmation is sent or falsely claimed saved.

### Owner action

- Review the local terminal appearance. No new env value is required.
- Explicitly approve the web-only testnet/mainnet Railway release when ready. Backend/indexer redeployment is not required for these web changes. After release, test wallet login and small mainnet/testnet swap/add/remove flows; local screenshots and anonymous API checks do not complete signed acceptance.
- PONS swap-history chart may be empty until actual observations exist for the chosen source/timeframe. The terminal does not invent candles or treat reference prices as pool execution prices.

## 2026-10-21 — Shielded v2 mainnet runtime integration

Mainnet deployment remains **27/27 successful** with actual fee
`0.000252066642098 ETH`. Local runtime integration is **100%** and the mainnet
activation tracker is **4/5 (80%)**; Railway and signed browser acceptance are
not included.

- Installed the seven hash-checked action/fund/note public assets under
  `/zk/mainnet/v2/` and sealed trust metadata as `single-operator-mainnet`.
  The active local manifest binds proxy `0x81d7…e8cb4`, deployment receipt,
  runtime hashes, tree version 2 and block 94057275. Candidate trust metadata is
  never accepted as a runtime release.
- Added a strict asset policy: WETH, USDG, AMD, AMZN, NFLX, PLTR, TSLA, MSFT and
  META are enabled; PONS is catalogued but fail-closed as `enabled:false` because
  the vault reports it disabled onchain. API exposes this state and startup/indexer
  validation compares every flag with `assetEnabled` before service use. UI blocks
  unsupported private-market submissions while leaving public Trade unaffected.
- Applied only `202610210001_private_intent_events.sql` to `zkblast_mainnet` and
  verified 20 backend-only tables with RLS. Dedicated v2 indexer caught up from
  deployment to finalized block 94060938; zero events is expected before owner use.
- Local API started successfully on chain 4663; `/v1/config` returned the verified
  v2 deployment, pinned prover and PONS=false without private configuration.
  Config 18/18, API 39/39, indexer 27/27 and focused web 10/10 pass; relevant
  typechecks/lint pass. Initial API test sandbox failures were loopback EPERM only
  and pass outside that restriction. No repeated full build/circuit suite.
- Existing mainnet v1 vault, USDG note configuration, testnet manifest and Railway
  services were not modified. No deposit, swap, LP, withdrawal or acceptance fund.

PONS activation is recorded in `deployments/mainnet/shielded-v2-pons-plan.json`:
Safe nonce 30 and owner nonces 336/830 were consumed by exactly approveHash plus
execTransaction. Both canonical receipts succeeded; actual fee
`0.00000284044426 ETH` stayed below `0.000007054894972 ETH`. Vault reports PONS
enabled, final Safe nonce 31 and owner nonces 337/831. Manifest/UI policy was
updated to `enabled:true`; indexer revalidated the live flag and reached finalized
block 94063325. No Railway, deposit, swap, LP or withdrawal operation occurred.

Owner action: separately authorize a Railway batch when ready. After rollout, perform
the mainnet browser lifecycle with a fresh small note and never share its secret,
passphrase, backup or private key.

## 2026-10-21 — Shielded v2 mainnet Railway rollout complete

The explicitly authorized mainnet-only batch is **3/3 successful (100%)**. Mainnet
runtime integration and release are **100%**; the activation tracker remains
**4/5 (80%)** because owner-signed browser lifecycle/recovery acceptance is still open.

- `web-mainnet` deployment `566ca25d-118e-4e0d-a584-7f25bcf5e707`, `api-mainnet`
  deployment `dd9771d1-da4c-4a89-bcdf-3fcea964fc70`, and `indexer-mainnet`
  deployment `0a4ed4b0-c373-4fd3-b115-d8a7cf3f8787` all reached `SUCCESS`.
- Live `/trade`, web-proxied `/api/v1/config`, `/zk/mainnet/v2/manifest.json`, and
  API `/health` return HTTP 200. The public config binds chain 4663, verified vault
  `0x81d7EaA9B144e58D6Ce0e0e7e04876d5aeDe8cb4`, and ten enabled assets including PONS.
- Downloaded each public action/fund/note WASM, zkey and verification key once after
  release; all seven SHA-256 values exactly match the live manifest. The manifest
  itself matches pinned SHA-256 `10a56435ee56fdeb024a4262f14a377f49dd361e4d316ecc4c430f61c8d9d77b`.
- Indexer runtime reports `status=sync`, chain 4663 and advancing finalized blocks;
  the sampled startup/runtime logs contain no error. No testnet deployment, env
  mutation, onchain transaction, user-note operation or v1 USDG change occurred.

Owner action: hard-refresh the mainnet Trade page, connect a wallet on chain 4663,
and complete one small Shielded v2 deposit, swap, LP add/remove, withdrawal and
encrypted restore/refund lifecycle. Record only transaction hashes and visible error
messages; never share a note secret, passphrase, backup file or private key.

## 2026-10-23 — Cloudflare/VPS audit and Shielded v2 delivery fix

Slice 30 is **80% (4/5)**. The full roadmap checklist is **89.5% (297/332)**;
the denominator increased by five explicit operational tasks. This percentage is task
accounting, not a security certification. No production deployment or transaction was
performed.

- Re-audited the current infrastructure after Railway retirement. `zkblast.tech`,
  `/trade`, same-origin config and the v2 manifest return HTTP 200. The VPS API health,
  config, readiness, ten-pool response, metrics and v2 intent status work; readiness
  reported indexer lag between 5 and 12 blocks. Browser inspection found no console
  error. Onchain v2 remains tree version 2, unpaused for deposits/actions/withdrawals,
  with zero leaves before owner acceptance.
- Confirmed the live mainnet UI still exposes only legacy Deposit/Backup/Withdraw because
  `ShieldedExecutionPanel` gated Private v2 on `environment === testnet`. Replaced that
  condition with availability of a validated `shieldedV2.proverRelease`, preserving
  isolated mainnet/testnet scope and the existing v1 vault tab.
- Confirmed six v2 proof assets match the live manifest, while the 52,974,896-byte
  `action.zkey` route fails through Cloudflare with HTTP 500/error 1101. All three
  already-published chunks return their expected byte lengths. Extended the strict
  release schema with per-part paths/hashes and changed the browser prover to verify
  each part, concatenate locally, then verify the original full zkey hash. Removed the
  failing server aggregation route.
- Mainnet chunks reconstruct to `8528100a331bc3b072f43a83c85fbc68d14d7f2e8bc8df5f68c16c3018127a6f`;
  testnet chunks reconstruct independently to `6c4b202e0086a4f8cfdd71de5e15f46d921ffb40e6d2443abd014d49c0d9eaa0`.
  New manifests are pinned as mainnet `c1ff9776fba2cdfc9b37b6af8c9349bff5a3ee85ecf29169e295c50e51a1a857`
  and testnet `0d25d509d32b12957d81454c2eaa57e09cefda08f5b38b9f705b39a8b75f95f8`.
- One focused verification batch only: private worker 4/4, config 19/19, web typecheck
  and `git diff --check` pass. The worker bundle was generated once and one Cloudflare
  release build passed. No repeated full build, monorepo suite, environment change or
  onchain write occurred.
- One local mainnet preview against the public VPS API confirms the `USDG vault` and
  `Private v2` tabs render independently. The local server was stopped after inspection.
- Committed the coordinated release as `b862ccf` and pushed `main` once. The Git-triggered
  Cloudflare build completed successfully and the VPS API adopted the same manifest
  configuration without any new environment variable. Production serves mainnet manifest
  SHA-256 `c1ff9776fba2cdfc9b37b6af8c9349bff5a3ee85ecf29169e295c50e51a1a857`
  and worker SHA-256 `4c8a1daf9a303301a3c90e41c204797f86ad58e5e471b17720c4945e3187d9c6`.
  API readiness is healthy and the sampled finalized-indexer lag is 9 blocks.
- Actual production browser verification confirms Trade → Shielded exposes separate
  `USDG vault` and `Private v2` tabs. Selecting Private v2 renders the mainnet-scoped
  journal passphrase and `UNLOCK / CREATE JOURNAL` control. No console warning or error
  was emitted. No wallet connection, note mutation or transaction was performed.

Next: complete the owner-wallet tiny-value mainnet lifecycle acceptance. Hard-refresh
Trade, connect a chain-4663 wallet, create a new v2 journal and exercise deposit, encrypted
backup, private swap, private LP add/remove, settlement/refund, restore and withdrawal.
Record transaction hashes and visible errors only; never share note secrets, passphrases,
backup files or private keys.

## 2026-10-23 — Simplified Shielded v2 guided flow

Slice 30 remains **80% (4/5)** and the complete roadmap remains **89.5%
(297/332)**. This refinement completes a nested UI subtask but does not replace the
remaining owner-wallet mainnet lifecycle acceptance.

- Replaced the nested Private v2 `Deposit / Swap-LP / Backup / Withdraw` tabs and the
  second `Swap / Add LP / Remove LP` tab row with one responsive `I want to` selector.
- Kept deposit, private swap, DAMM/DLMM liquidity add/remove and withdrawal on the same
  screen. Changing the desired operation resets stale selections without locking or
  discarding the encrypted journal.
- Moved backup and restore into a persistent recovery checkpoint. Users can save or
  restore the encrypted journal without navigating away from their current operation.
- Renamed intent controls into a direct sequence: `1. Submit`, `2. Complete`, and
  `Recover expired`, while preserving the underlying reserve, settle and refund calls.
- Scoped verification only: web typecheck, ESLint on the two changed components,
  `git diff --check`, and one local mainnet preview against the public API all pass.
  The unlocked preview shows all five operations and no browser warning or error.
- No proof logic, contract, manifest, API, indexer, environment, wallet, note, onchain
  state or production deployment was changed. No Git push was performed.

Next: review the simplified production candidate, then publish it through one approved
Git push before the owner-wallet mainnet acceptance run.

## 2026-10-23 — Unified Shielded positions and full protocol activity

Slice 30 remains **80% (4/5)** and the complete roadmap remains **89.5%
(297/332)**. The remaining gate is still owner-wallet mainnet lifecycle acceptance.

- Removed the technical `USDG vault / Private v2` version tabs from the Trade action
  panel. The right panel now contains one current Shielded execution flow.
- Added a Shielded section to Positions, available even before wallet login. It shows
  session-only counts for private token notes, private LP notes, active intents and
  submitted transactions after the encrypted journal is unlocked. Only aggregate counts
  are shared in browser memory; note secrets, commitments and passphrases are not copied.
- Preserved access to existing v1 USDG notes under the collapsed `Manage legacy USDG
  notes` section in Positions, so this UI change does not strand prior deposits.
- Added `GET /v1/protocol/activity` over canonical indexed events with optional normalized
  transaction-sender filtering. Network activity now covers pool creation/registration,
  swaps, positions, liquidity, fee claims, Shielded deposits/withdrawals and private
  reserve/settle/refund events. History combines authenticated receipt records with
  wallet-filtered indexed activity.
- Extended indexer classification for v1/v2 deposits and withdrawals, aggregate/private
  LP lifecycle, pool registration and emergency recovery events.
- Scoped verification: API/web/indexer typechecks, ESLint on changed runtime files,
  API protocol test 5/5, `git diff --check`, and one local UI preview pass. The preview
  confirms no Shielded version tabs and shows the Shielded badge/summary in Positions.
  Production activity data was not claimed because the new API route is not deployed yet.
- No environment, database schema, private note, wallet, onchain state or production
  deployment changed. No Git push was performed.

Next: publish the prepared web/API/indexer commit together through one approved Git push,
then verify canonical activity results and proceed with the owner-wallet acceptance flow.

## 2026-10-30 — WETH-PERP first-market fail-closed preflight

Perps implementation remains **99%**, delivery readiness advances to **99%**, and capped
mainnet launch Slice P14 advances from **53% to 57%**. No transaction, Git commit, push,
build, or production deployment was performed.

- Added one environment-driven first-market planner for Chainlink feed validation, role
  checks, deterministic market/oracle identifiers, disabled market registration, funding
  cap configuration, immediate market pause, USDG funding readiness and Safe-aware gas
  modelling.
- Revalidated the Robinhood Chain mainnet Chainlink standard proxy
  `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`: deployed runtime, `ETH / USD`, 8
  decimals, positive complete round and 2,169-second sampled age under the 90,000-second
  fail-closed maximum age.
- Frozen tiny-value limits match the owner decision: 1 USDG aggregate open interest,
  0.5 USDG max skew, 0.25 USDG per position, 0.1 USDG minimum and 2x leverage.
- Prepared four configuration actions with an estimated target total of 402,551 gas and
  a conservative Safe-aware fee ceiling of 0.000056124480816 ETH. WETH-PERP remains
  disabled and will be paused; engine openings and vault positions remain paused.
- Recommended funding remains separate: 3 USDG LP plus 1 USDG Insurance Fund. The Safe
  currently holds 0 USDG, while vault and Insurance Fund both hold 0, so no allowance or
  asset transfer was prepared.

Next: after explicit approval, freeze the current Safe nonce and owner signatures, then
broadcast only the four market-configuration actions within a bounded gas ceiling. LP and
Insurance funding require 4 USDG at the governance Safe and a separate approval.

## 2026-10-30 — All active pools included in the Perps catalog

Perps implementation remains **99%**, Slice P03 advances from **70% to 78%**, Slice P14
advances from **57% to 61%**, and capped-mainnet launch readiness advances to **82%**.
No transaction, token approval, database mutation, Git commit, push, or production
deployment was performed.

- Read the canonical mainnet database and found 11 active protocol pools across 10 unique
  underlyings: AMD, AMZN, META, MSFT, NFLX, PLTR, PONS, TSLA, WETH and ZKBLAST. PONS
  has both DAMM and DLMM pools and therefore maps to one shared PONS-PERP market.
- Added a versioned all-pool catalog and fail-closed governance planner. It verifies every
  token and pool runtime, feed bytecode, decimals, description, positive complete round,
  timestamp and freshness before producing calldata.
- Direct preflight validates independent feeds for AMD, AMZN, META, MSFT, PLTR, TSLA and
  WETH. NFLX, PONS and ZKBLAST are included as registered candidates but remain disabled,
  paused and `oracle_required`; AMM spot prices are not used as leverage oracles.
- Prepared 37 Safe actions for 10 disabled/paused market registrations, seven feed
  configurations and bounded funding-rate configuration. Each market is capped at 0.1
  USDG OI, making the aggregate catalog cap at most 1 USDG with 2x maximum leverage.
- Conservative Safe-aware fee ceiling is `0.00052549857936 ETH`. Funding remains a
  separate step and the engine/vault opening switches remain paused.

Next: freeze Safe nonce/signatures and broadcast the all-market registration batch only
after explicit cost approval. Then provision 3 USDG LP plus 1 USDG insurance and activate
the seven oracle-valid markets one at a time; missing-oracle markets stay visible but
non-executable.

## 2026-10-30 — All-pool Perps registration executed on mainnet

Slice P03 advances from **78% to 90%**, Slice P14 advances from **61% to 68%**, and
capped-mainnet launch readiness advances from **82% to 87%**.

- Transferred exactly 4 USDG from deployer
  `0xB5C0eD0252d1906Fca50664Eb2198Aea0679920B` to Governance Safe
  `0xc082aC032Cb5d950fe533C2D33e81A24fFb538e8`; deployer retains 0.47728 USDG.
- Executed all 37 Safe actions and verified all 10 markets covering 11 active pools are
  registered, disabled and paused. Seven independent feeds are configured; NFLX, PONS
  and ZKBLAST remain fail-closed pending independent feeds.
- Total actual fee for 38 confirmed transactions was `0.000103324513688 ETH`, below the
  approved `0.00053 ETH` cap. Safe nonce ended at 73.
- Engine openings and vault positions remain paused. The Safe retains all 4 USDG; no LP
  deposit, Insurance Fund transfer, market enablement, relayer activation or production
  deployment was performed.
- The production database has not projected the new market events yet because the current
  indexer service is not running the prepared Perps projection release. No manual rows
  were fabricated.

Next: run the prepared indexer/API release through the normal Git deployment path, verify
10 market and 11 catalog projections, then preflight the separate 3 USDG LP + 1 USDG
insurance funding and activate the seven oracle-valid markets one at a time.

## 2026-10-30 — Managed-alpha oracle plan for remaining Perps markets

Slice P03 advances from **90% to 94%** and Slice P14 advances from **68% to 70%**.
No broadcast, USDG movement, Git commit, push or production deployment was performed.

- Confirmed the official Robinhood Chain feed registry does not currently expose NFLX,
  PONS or ZKBLAST feeds. All three markets remain disabled and paused.
- Added `BoundedManagedPriceFeed`, an AggregatorV3-compatible alpha fallback. Only the
  dedicated reporter may submit observations; stale/future timestamps, non-positive
  answers, timestamp rollback and excessive per-update deviations revert onchain.
- NFLX is planned from the existing external reference with a 5% update bound and
  15-minute age. PONS is planned from PONS/WETH reference converted through Chainlink
  ETH/USD with a 10%/15-minute bound. ZKBLAST is planned from its USDG reference with a
  10%/5-minute bound. These are explicitly managed feeds, not decentralized Chainlink
  feeds.
- Focused contract verification passes 2/2. TypeScript contract tooling typecheck passes.
- Preflight predicts three feed addresses and three Safe configuration actions. The
  conservative fee ceiling is `0.0001228041153 ETH`; market enablement and funding are
  intentionally excluded.

Next: after explicit fee approval, recheck nonce/source freshness, deploy the three feeds,
configure them in ChainlinkOracleAdapter and verify all markets remain disabled/paused.

## 2026-10-30 — Remaining three mainnet Perps oracles deployed

Slice P03 advances from **94% to 97%**, Slice P14 advances from **70% to 74%**, and
capped-mainnet launch readiness advances to **92%**.

- Deployed bounded managed-alpha feeds for NFLX, PONS and ZKBLAST at
  `0x3288DC7b5914F984588Fe79e45f8f89CDf8700F4`,
  `0x2cAa8AC140407538f4567E8499acA3e9e941544d`, and
  `0x6d57DE017f8Ff7b3EEC8B43581b3F5252654f27A`.
- Configured all three through the Governance Safe and verified ChainlinkOracleAdapter
  returns a positive fresh normalized value for every feed.
- Six confirmed transactions consumed `0.00004702473169 ETH`, below the approved
  `0.000123 ETH` cap. No USDG moved.
- NFLX-PERP, PONS-PERP and ZKBLAST-PERP remain disabled and paused. The overall engine
  openings and vault positions remain paused; this batch did not activate trading.
- Updated the catalog to distinguish `managed_alpha` from Chainlink feeds rather than
  representing all ten sources as equally decentralized.

Next: refresh the all-market preflight, publish the indexer/API projection release, fund
LP/insurance from the Safe and activate markets only while their oracle reporters remain
fresh.

## 2026-10-23 — Clear saved-journal passphrase feedback

- Detect an existing network-bound encrypted journal before unlock and tell the user to
  enter the same passphrase used when it was created.
- Map AES-GCM authentication failure to a recovery-safe message directly below the unlock
  button: the passphrase does not match the saved journal, with a suggestion to retry or
  restore the latest encrypted recovery file. Raw browser crypto errors are not exposed.
- Clear the prior message as soon as the user edits the passphrase. A short passphrase
  remains a distinct validation error and no journal data is changed on failed unlock.
- Verification: scoped web typecheck/lint and `git diff --check` pass; private journal
  tests pass 4/4; an actual local browser sequence created, persisted and locked a journal,
  then confirmed the friendly message after a wrong passphrase. No transaction or
  production deployment was performed.

## 2026-11-02 — Mainnet launchpad canary compatibility preflight

Slice L16 remains **72.7% (8/11)** and overall progress remains **92.0% (172/187)** because
no mainnet compatibility transaction or canary economic action has been broadcast yet.

- Live preflight at block `103905063` confirmed deployer nonce `579`, Governance Safe nonce
  `101`, the 300-second timelock, and sufficient ETH/USDG balances.
- The canary found a deterministic legacy mismatch before using funds: mainnet
  `VirtualPoolDeployer` does not contain `deployForLaunchpad`, although the current artifact
  and `LaunchpadTokenFactory` require it.
- Added an admin-gated, storage-compatible `LaunchFactory.setPoolDeployer` rotation path.
  Existing launch records and pools remain unchanged; only future launches use the new
  one-time-bound deployer. Storage compatibility passed and focused rotation/lifecycle tests
  passed 2/2.
- A mainnet fork successfully deployed the replacement deployer and factory implementation,
  bound it through the Governance Safe, scheduled and executed the proxy upgrade through the
  5-minute timelock, and rotated the deployer. The subsequent canary created launchpad `1`,
  configured its fee policy, and created its bound token/pool successfully.
- The conservative two-times-gas/Safe-aware upgrade ceiling is `0.00036842503882 ETH`.
  Nothing was broadcast, no asset moved, and Railway/Cloudflare/Coolify services were not
  deployed by this step.

Next: obtain an explicit mainnet broadcast cap, execute the bounded compatibility upgrade,
verify every receipt and live invariant, then continue the minimum-value token trade, fee
claim, and DAMM graduation canary.

## 2026-11-02 — Mainnet launchpad canary completed and indexed

Slice L16 advances to **81.8% (9/11)** and overall progress advances to **92.5% (173/187)**.

- Kept the LaunchFactory proxy at `0xB6BD21A7E9E573F30f0e5175551Ab1be009a545B`,
  upgraded through the 5-minute timelock, and rotated future launches to the compatible
  VirtualPoolDeployer `0x3086f8699ca40aFAb009A6156efb75aF4612E10f`.
- Completed launchpad `1`, bound launch
  `0x3a596648e8006f4635fe51fe1fb79a9667f234eeb9b8a78d434003ab62c1c96d`,
  buy/sell probes, fee collection/claim, and DAMM graduation. Gross canary capital was
  `1.008021 USDG`; actual gas was `0.000193079402564 ETH`.
- Extended the isolated mainnet event-kind constraint, repaired DBC tuple decoding and
  dependency-aware projection, and backfilled 54 events across eight relevant blocks.
  Production API acceptance returned the launchpad and graduated token with lag zero.
- The UI now exposes one unambiguous token-creation trigger per owned launchpad. The canary
  is graduated; users should create a fresh token to test active curve trading.

Next: observe indexer/RPC/webhook behavior over a sustained window, then publish final
contract and capability documentation with current limitations.
