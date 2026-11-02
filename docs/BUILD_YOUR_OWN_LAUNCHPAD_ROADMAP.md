# ZKBLAST Build Your Own Launchpad — Development Roadmap

Status: active; inventory and isolation specification complete

Date: 2026-11-01

Source of truth: `docs/ZKBLAST_BUILD_YOUR_OWN_LAUNCHPAD_BRIEF.md`
Target: Robinhood Chain, with isolated testnet and mainnet manifests/configuration

## 0. Progress and delivery rules

- `[x]` means implemented and supported by the evidence in the slice exit gate.
- `[ ]` means incomplete, including code that has not passed its focused slice gate.
- Existing DBC, DAMM, DLMM, Shielded, SDK, API, indexer, and UI code is reused only after compatibility and live-deployment verification.
- This feature creates launchpads that contain token launches. It does not replace the existing `/launch` token-launch flow without an explicit migration plan.
- Browser code receives no RPC credential, database credential, signer key, webhook secret, or administrative secret.
- Testnet and mainnet retain separate environment files, manifests, schemas, cursors, domains, and evidence.
- State-changing operations remain wallet-signed. API quotes and indexed data are advisory/read-only.
- Development uses focused checks per slice. Full build, contract suite, E2E, and deployment checks run only at their designated gates.
- No contract broadcast, production deployment, DNS mutation, or secret creation is authorized by this roadmap.
- Public ERC-20 swaps are not described as private. ZK claims must match the exact proof statement implemented.
- Mainnet rollout requires a separate transaction plan, gas estimate, signer/nonce validation, and explicit approval.

## 1. Product boundary

The product adds a permissionless white-label launchpad layer above ZKBLAST DBC. A launchpad has an isolated owner, pending owner, treasury, metadata commitment, unique slug commitment, approved configuration preset, fee policy, status, and version. Token launches created inside it inherit an immutable snapshot of launchpad identity, fee policy, curve preset, and graduation destination.

Phase 1 supports Robinhood Chain only. DAMM graduation is mandatory. DLMM graduation is exposed only when a compatible deployed adapter passes end-to-end acceptance. Custom domains, API keys, webhooks, hosted partner pages, and embeddable widgets are offchain capabilities bound to onchain ownership and signed/versioned metadata.

## 2. Dependency map

```text
Existing DBC deployment and source/live-chain inventory
                         ↓
Isolation, ownership, metadata, fee, and upgrade specifications
                         ↓
 Registry ← Config Manager ← Fee Controller ← Revenue Splitter
                         ↓
                 Launchpad Factory
                         ↓
 Existing LaunchFactory/Router/VirtualPool with launchpad snapshot binding
                         ↓
 DAMM graduation state machine → optional verified DLMM adapter
                         ↓
 Database/indexer/API/webhooks → SDK → Builder/Public page/Dashboard
                         ↓
      Focused testnet acceptance → approved mainnet rollout
```

## 3. Development slices

### [x] Slice L00 — Existing-system inventory and compatibility matrix (10/10, 100%)

**Goal:** establish which existing modules can be reused without assumptions or accidental mainnet breakage.

- [x] Inventory current DBC contracts, proxies, implementations, bytecode hashes, ABIs, roles, timelocks, dependencies, and deployment blocks on both networks.
- [x] Verify the nine user-supplied mainnet addresses against the active deployment manifest and recorded live-code verification.
- [x] Trace create launch, buy, sell, fee accrual/claim, graduation, indexing, API, and UI paths end-to-end.
- [x] Verify current DAMM and DLMM factories, registries, adapters, pool capabilities, ownership, and deployability; DBC-to-DLMM graduation is explicitly unsupported until L09.
- [x] Identify storage/ABI/event compatibility constraints for extending `LaunchFactory`, router, pools, and graduation.
- [x] Inventory reusable Shielded/nullifier/verifier components without coupling private note custody to public launchpad creation.
- [x] Inventory current database schemas, DBC metadata model, cursors, API limits, and realtime reconciliation.
- [x] Record reuse/extend/new decisions for every component in the brief.
- [x] Define a backward-compatibility plan for existing standalone launches and URLs.
- [x] Produce `BUILD_YOUR_OWN_LAUNCHPAD_INTEGRATION_INVENTORY.md` without credentials or private operational data.

**Exit:** every dependency is classified as compatible, requires extension/migration, or unsupported, with live-chain and source evidence.

### [x] Slice L01 — Domain specification, isolation model, and threat model (11/11, 100%)

**Goal:** freeze invariants before writing storage-bearing contracts.

- [x] Specify launchpad ID, slug commitment, metadata hash, owner, pending owner, treasury, operator, status, version, and config relationships.
- [x] Specify two-step owner transfer, treasury rotation, metadata revision, pause, disable, and recovery transitions.
- [x] Specify cross-launchpad isolation for configuration, token launches, balances, fees, referrals, graduation, and claims.
- [x] Define immutable-at-launch snapshot semantics and migration rules.
- [x] Define global safety caps versus launchpad-owner permissions.
- [x] Define upgrade boundaries, five-minute governance timelock compatibility, initialization, and storage-layout policy.
- [x] Define metadata signing/content addressing, upload sanitization, size/type limits, and phishing/XSS controls.
- [x] Define custom-domain DNS challenge, verification expiry, takeover prevention, and removal behavior.
- [x] Define API key, webhook secret, rotation, replay, and revocation threat boundaries.
- [x] Define the initial fee-claim authorization ZK statement and document public information/privacy limits.
- [x] Produce state diagrams, trust boundaries, abuse cases, and recovery inputs in `BUILD_YOUR_OWN_LAUNCHPAD_SPECIFICATION.md`.

**Exit:** two independently created launchpads cannot influence each other's state under the written model.

### [x] Slice L02 — Launchpad registry and ownership foundation (10/10, 100%)

**Goal:** provide an isolated canonical onchain identity for every launchpad.

- [x] Implement upgradeable `LaunchpadRegistry` using existing proxy/access primitives.
- [x] Store unique ID, owner, pending owner, treasury, metadata hash, slug commitment, status, config preset, and version.
- [x] Enforce unique canonical slug commitment and deterministic ID rules.
- [x] Implement two-step ownership transfer and bounded treasury update events.
- [x] Scope operator permissions to cosmetic/offchain metadata operations only.
- [x] Prevent one launchpad owner/operator from mutating another launchpad.
- [x] Add emergency pause semantics that cannot drain reserves or redirect claims.
- [x] Emit complete stable events suitable for replay/indexing.
- [x] Add storage-layout baseline and upgrade authorization checks.
- [x] Add focused unit tests for uniqueness, ownership, isolation, zero addresses, invalid transitions, and state-preserving upgrades.

**Exit:** registry isolation and ownership transitions pass focused contract tests with stable indexer-ready events.

### [x] Slice L03 — Safe configuration manager and permissionless factory (11/11, 100%)

**Goal:** let any wallet create a launchpad while governance controls only global safety bounds.

- [x] Implement `LaunchpadConfigManager` with versioned approved presets and global caps.
- [x] Bind quote allowlist, existing DBC template/supply/decimal safety, curve family, capacity, graduation route, launch constraints, and fee caps.
- [x] Reuse existing DBC template IDs where compatible instead of duplicating curve math.
- [x] Reject unsafe, unsupported, disabled, or over-cap configuration combinations; DLMM remains disabled by default.
- [x] Implement permissionless `LaunchpadFactory.createLaunchpad`.
- [x] Validate caller/owner, treasury, metadata hash, slug commitment, preset, and zero creation fee.
- [x] Register launchpad ID atomically and prevent duplicate slug/replay.
- [x] Keep factory governance unable to seize launchpad treasury or partner fees.
- [x] Add `LaunchpadLens` batched read methods for registry/config/status data.
- [x] Add factory deployment/upgrade scripts and manifest schema without broadcasting.
- [x] Demonstrate two isolated launchpads from independent caller contracts in focused local tests.

**Exit:** any wallet can create an isolated launchpad from a safe preset without admin approval.

### [x] Slice L04 — Fee controller and revenue splitter (12/12, 100%)

**Goal:** make every fee bounded, conserved, attributable, and independently claimable.

- [x] Implement `LaunchpadFeeController` with global caps and launchpad-owner scoped configuration.
- [x] Implement pull-based `RevenueSplitter` per launchpad, pool, recipient, and asset.
- [x] Support protocol, operator, creator, and optional referral shares whose sum exactly equals the fee allocation.
- [x] Snapshot fee policy when a token launch/pool is created.
- [x] Prevent later launchpad changes from mutating existing pool economics.
- [x] Separate trade, pool, graduation, and LP reward accounting and UI labels.
- [x] Handle zero referral, recipient rotation for future pools, dust, rounding, and zero-volume paths.
- [x] Prevent cross-launchpad claims and arbitrary recipient substitution.
- [x] Emit `FeePolicySnapshotted`, `FeeAccrued`, and `FeeClaimed` events with complete identifiers.
- [x] Add conservation/property tests across minimum, maximum, and uneven split values.
- [x] Extend lens/SDK read and claim transaction preparation.
- [x] Define claim reconciliation and failed-transfer recovery without forced transfers during trades.

**Exit:** all accrued units reconcile to exactly one liability/recipient and cannot be claimed across launchpads.

### [x] Slice L05 — Bind token launches to launchpads (11/11, 100%)

**Goal:** launch tokens through existing DBC while preserving immutable launchpad attribution and old launches.

- [x] Design a backward-compatible extension or versioned factory path rather than silently changing existing launch semantics.
- [x] Bind launchpad ID, config snapshot, fee snapshot, creator, treasury, and graduation destination to each new token launch.
- [x] Validate caller permission policy while retaining permissionless creator access where configured.
- [x] Prevent a token/pool from being rebound to another launchpad.
- [x] Route trade fees to the snapshotted splitter without changing reserve/graduation invariants.
- [x] Preserve current exact-in quote, slippage, deadline, price-impact, buy, sell, and claim behavior.
- [x] Preserve standalone legacy launches and indexer replay.
- [x] Extend events/ABIs/manifests with explicit schema versions.
- [x] Extend quoter output with exact fee split and launchpad attribution.
- [x] Add two-launchpad concurrent trading/isolation integration scenarios.
- [x] Add migration/read compatibility for the existing `/launch` surface.

**Exit:** two launchpads can create/trade independent DBC tokens while legacy launches remain readable and executable.

### [x] Slice L06 — Branding, metadata, slug, domain, and hosted surface (12/12, 100%)

**Goal:** create safe, responsive white-label launchpads without leaking ZKBLAST operational configuration.

- [x] Add environment-isolated launchpad metadata/domain tables, constraints, RLS, and migrations.
- [x] Implement sanitized logo/favicon uploads with explicit MIME/size/dimension limits.
- [x] Store signed/versioned branding records and verify their hash against onchain metadata commitment.
- [x] Implement unique human-readable slugs and `/launchpads/{slug}` routing.
- [x] Implement DNS challenge creation, verification, renewal, revocation, and takeover prevention.
- [x] Implement theme tokens for name, description, logo, colors, socials, and links with accessibility contrast checks.
- [x] Build responsive public token grid, launch detail, chart, buy/sell, progress, history, and claim views.
- [x] Build safe hosted template and embeddable widgets with strict origin/CORS configuration.
- [x] Prevent arbitrary scripts, unsafe URLs, SVG script execution, CSS injection, and deceptive wallet prompts.
- [x] Preserve network/chain identity and ZKBLAST protocol attribution while allowing partner branding.
- [x] Add skeleton/error/empty states and transaction-success receipts.
- [x] Verify desktop, tablet, and mobile layouts at the slice gate.

**Exit:** a launchpad owner can publish a branded hosted page whose record is ownership-bound and safe to render.

### [x] Slice L07 — Builder, configurator, preview, and deploy UX (11/11, 100%)

**Goal:** make launchpad creation understandable without exposing unsafe controls.

- [x] Build a single guided flow for identity, branding, owner/treasury, preset, fees, domain, preview, and deployment.
- [x] Show only approved presets and explain immutable versus editable values.
- [x] Add visual curve/progress preview from the same SDK math used by quotes.
- [x] Add fee split editor with live 100% validation and recipient checks.
- [x] Display gas estimate, exact chain, addresses, expected events, and transaction summary before signing.
- [x] Require explicit wallet clicks for each approval/deployment transaction; do not queue hidden wallet requests.
- [x] Optimistically display a launchpad from confirmed receipt while the indexer reaches finality.
- [x] Add realtime reconciliation for builder status and deployment receipt.
- [x] Build partner dashboard for tokens, trades, fees, referrals, graduation, freshness, and failed transactions.
- [x] Add clear recoverable error messages without exposing internal credentials or stack traces.
- [x] Keep the launchpad creation flow reusable and separate from the existing token launch wizard.

**Exit:** a new user can create, preview, deploy, and open a launchpad without developer knowledge or page reloads.

### [x] Slice L08 — Graduation state machine and DAMM integration (12/12, 100%)

**Goal:** graduate a launchpad token exactly once with auditable reserve and LP accounting.

- [x] Verify existing `GraduationManager` and DAMM adapter compatibility with launchpad/fee snapshots.
- [x] Implement explicit `TRADING`, `READY`, `GRADUATING`, `PENDING_RETRY`, `GRADUATED`, and `FAILED_NEEDS_REVIEW` states.
- [x] Freeze duplicate trading/graduation transitions at the correct point.
- [x] Bind launchpad ID and immutable migration destination to the migration receipt.
- [x] Reconcile reserves, liabilities, charges, token supply, dust, and unused assets before/after migration.
- [x] Validate destination pool identity, fee tier, token order, price bounds, minimum liquidity, and deadline.
- [x] Record LP shares/position receipt and their creator/operator/protocol/escrow allocation.
- [x] Support permissionless triggering with replay-safe migration IDs.
- [x] Support guarded retry without double pool creation or double funding.
- [x] Emit start/completion/pending/failure events and expose explorer links.
- [x] Extend dashboard/indexer observability for every graduation state.
- [x] Add exact-threshold, overshoot, adapter failure, retry, concurrent trigger, and success scenarios.

**Exit:** a token graduates into a functioning DAMM exactly once and every asset/LP receipt reconciles.

### [x] Slice L09 — Conditional DLMM adapter (9/9, 100%)

**Goal:** expose DLMM graduation only if the deployed integration is genuinely executable.

- [x] Verify live DLMM factory, registry, version, bin/tick model, pair support, custody, and ownership behavior.
- [x] Define bin distribution, initial active bin, price bounds, minimum shares, and dust behavior.
- [x] Implement capability detection and a versioned `DlmmGraduationAdapter` if compatible.
- [x] Bind adapter/factory/version/config in the launch snapshot.
- [x] Verify created pool identity, deposited assets, minted position/shares, and fee ownership.
- [x] Add failure/retry/no-double-migration scenarios.
- [x] Add SDK/API/UI capability flags sourced from the manifest/live state.
- [x] Hide or explicitly mark DLMM unavailable when the executable gate fails.
- [x] Complete a real testnet DLMM graduation before enabling the option. The eight-transaction canary completed at blocks `146624236–146624264`; pool `0x23876Ee4563CDB888DEE2B9Cdc834e35613143CD`, active bin `-2767`, accounting/escrow/dust invariants passed, and total fee was `0.00009378591 ETH` under the `0.00015 ETH` cap.

**Exit:** DLMM is either proven end-to-end or unavailable everywhere; interface existence alone is insufficient.

### [ ] Slice L10 — Scoped ZK authorization (10/11, 90.9%)

**Goal:** add one truthful proof-based authorization use case without misrepresenting public swap privacy.

- [x] Select the minimum useful action, preferably launchpad operator/fee-claim authorization or gated launch participation.
- [x] Reuse reviewed ZKBLAST commitment/nullifier primitives only where their domain and accounting semantics match.
- [x] Bind chain ID, verifier/adapter, launchpad ID, pool ID, action, public constraints, deadline, version, and nullifier.
- [x] Implement/extend circuit, deterministic vectors, verifier, adapter, and nullifier replay protection. The v1 statement folds all 15 public terms into the witness-bound context, uses a strict Groth16 bytes adapter, and retains single-use nullifiers in `LaunchpadProofClaimAdapter`.
- [x] Reject wrong chain, launchpad, pool, action, version, deadline, amount constraint, and spent nullifier.
- [x] Pin proving/verifying artifacts and publish non-secret hashes/manifest. Candidate manifest SHA-256: `8ab0c9686c4f89d606a04920aa7bb178509a58989b16336fac2267b5d2ec312a`; the manifest pins circuit source, verifier, WASM, zkey, verification key, valid vector, and negative mutation set.
- [x] Add browser/SDK proof generation with explicit loading, recovery, and failure states. The worker reports manifest/artifact/witness/proving/complete stages and stable failure codes; the SDK validates canonical ranges and prepares commitment and proof-claim calls.
- [x] Emit proof verification receipt without witness/note leakage.
- [x] Keep the feature optional and provide a normal public path where product policy permits.
- [x] Document exactly what is hidden and what remains public onchain.
- [ ] Complete focused valid/invalid/replay/onchain acceptance before activation.

**Exit:** one real proof statement is verified onchain with replay protection and accurate privacy language.

### [x] Slice L11 — Indexer, database, realtime API, and observability (12/12, 100%)

**Goal:** expose canonical launchpad data without trusting frontend submissions.

- [x] Add launchpad, ownership, metadata revision, domain, config snapshot, fee, referral, webhook, and graduation schema. Testnet/mainnet migrations remain schema-isolated, RLS-enabled, service-role-only, and retain onchain block/transaction provenance.
- [x] Index new events canonically with reorg handling and environment-scoped cursors. Registry ownership/metadata/status, fee policy/snapshot, revenue snapshot, authorization and proof receipt events decode into the canonical event plane. A rewind now removes mutable launchpad projections and deterministically replays every surviving canonical launchpad event in block/log order before checkpoint recovery.
- [x] Preserve current DBC realtime trade/chart/claim reconciliation. Existing DBC projection and its OHLCV, binding, retry, catch-up, reorg, validation and reconciliation tests remain green after the launchpad event-plane extension.
- [x] Add launchpad list/detail/tokens/fees/trades/graduation endpoints with Zod validation. Responses carry environment, chain ID, indexed/finalized block, lag and index timestamp; list pagination uses a stable `(updated_block, launchpad_id)` keyset cursor and all limits are bounded to 100.
- [x] Include chain ID, indexed/finalized block, freshness, UTC timestamps, and stable cursor pagination. Every launchpad read/event envelope includes environment and chain context plus index freshness; records retain UTC database timestamps and use bounded keyset/event cursors.
- [x] Add bounded quote endpoints sourced from verified deployment configuration. `POST /v1/launchpads/:launchpadId/quote` accepts a strict pool/side/positive-raw-amount body, requires a canonical launchpad-to-DBC pool binding and tradable lifecycle, then delegates to the deployed DBC quoter; arbitrary pools cannot obtain an executable launchpad quote.
- [x] Add launchpad observability states, failures, retries, and accounting reconciliation. Health reports graduation failures/retries, missing launch bindings, incomplete fee snapshots, webhook/domain state, RPC/index lag and explicit binding/fee-snapshot reconciliation booleans.
- [x] Prevent metadata/API records from inventing onchain ownership or economic state. Ownership/treasury/operator/status/economics are projected from canonical contract events; branding publication still requires an owner signature matching the current onchain owner and exact metadata commitment.
- [x] Add rate limits, request size limits, idempotency where applicable, and structured errors. Global body/rate bounds remain active; branding and domain mutations receive stricter per-route limits, exact signed branding retries are idempotent, and launchpad failures return stable bounded HTTP error codes instead of generic internal errors.
- [x] Expose realtime/event subscription transport without leaking private user/session data. Bounded polling and a 25-second SSE stream expose only an explicit allowlist of canonical public launchpad events, with resumable block/log cursors, keepalives, no-store caching and no auth/session/private-note fields.
- [x] Add health/freshness metrics for API, indexer, RPC, webhook queue, and domain verification. `/v1/launchpads/health` reports API state, RPC head/lag, indexed/finalized blocks, graduation failure/retry counts, projection reconciliation, pending/dead-letter webhooks, and pending/expired domains with healthy/stale/degraded status.
- [x] Add bounded catch-up/recovery tooling and runbook. Fast catch-up now includes manifest-bound launchpad contracts, retains chain/schema/confirmation/chunk/maximum-block guards and stops on changed ranges, removed logs, unregistered pools or orphaned checkpoints; the recovery runbook documents isolated rewind/replay and reconciliation.

**Exit:** API state is reproducible from chain events plus explicitly signed/versioned offchain metadata.

### [x] Slice L12 — Webhooks, developer settings, and API security (11/11, 100%)

**Goal:** let external builders integrate without custody keys or private backend knowledge.

- [x] Implement authenticated API key creation, scoped storage, display-once secret, rotation, and revocation. Owner-signed mutations bind chain, launchpad, action, detail hash, and a 15-minute timestamp; only a scrypt hash and independent salt are stored.
- [x] Implement webhook registration and endpoint ownership verification. Registration returns its secret and challenge once; activation requires a bounded HTTPS challenge response from the validated endpoint.
- [x] Sign payloads using per-client secrets and versioned timestamped envelopes. HMAC-SHA256 covers `v1.timestamp.raw-body`, with stable event ID and schema-version headers.
- [x] Add event IDs, replay protection, retry/backoff, dead-letter state, and manual retry. The queue enforces endpoint/event uniqueness, uses bounded 1/5/30/120/360-minute retry windows, and requires fresh owner authorization for manual replay.
- [x] Implement required launchpad/token/trade/graduation/fee event types. The allowlist covers launchpad configuration, token launch, trade, fee accrual/claim, and graduation readiness/completion/failure.
- [x] Prevent SSRF to private/local/link-local destinations and enforce HTTPS policy. DNS is resolved before connection, the TLS request is pinned to the validated address, non-443 ports and credential-bearing URLs are rejected, and response size/time are bounded.
- [x] Redact secrets and sensitive payload material from logs/errors. Secrets are display-once/encrypted or hashed, audit details are hashed, mutation errors remain stable codes, and the operational guide forbids logging payloads, signatures, cookies, and environment material.
- [x] Add per-key and per-IP rate limits and abuse monitoring. Developer mutations retain the stricter per-IP limiter; authenticated integration requests receive an independent per-key window, standard remaining/reset headers, stable 429 errors, request counts, last-used timestamps, and last-rate-limited timestamps.
- [x] Build Developer Settings UI for API keys, webhook state, delivery attempts, SDK snippets, and domains. The owner dashboard now provides launchpad selection, owner-signed snapshot access, display-once key/secret handling, create/rotate/revoke actions, endpoint registration/verification, failed delivery retry and a copyable integration snippet; the existing builder retains signed domain configuration in the same owner workflow.
- [x] Add audit trail for key/domain/webhook changes. Key and webhook mutations persist actor, action, target, chain-bound launchpad, timestamp, and a non-secret detail hash; domain changes retain their existing signed lifecycle audit state.
- [x] Document operational rotation and compromised-secret response. `LAUNCHPAD_DEVELOPER_SECURITY.md` covers environment isolation, receiver verification, replay handling, rotation, revocation, and incident response.

**Exit:** a partner receives verifiable, replay-safe webhook events without exposing server credentials or enabling SSRF.

### [x] Slice L13 — TypeScript SDK, OpenAPI, widgets, and starter app (11/11, 100%)

**Goal:** provide a public integration surface driven only by manifests and documented APIs.

- [x] Add typed SDK clients for launchpad create/read/update, curves, fees, graduation, ZK authorization, domains, and webhooks. `LaunchpadClient`, `DbcClient`, proof/revenue helpers and the new `LaunchpadApiClient` cover wallet calls, canonical reads, branding, domains, quotes and developer integrations.
- [x] Resolve contract addresses and capabilities exclusively from the selected network manifest/API config. Runtime parsing binds environment to chain ID, requires HTTPS outside localhost and detects launchpad/DAMM/DLMM availability without fallback addresses.
- [x] Add transaction preparation, chain/balance/allowance/deadline/slippage preflight, and explorer helpers. Existing prepared calls and DBC preflight/explorer helpers are now the documented public transaction path.
- [x] Generate/publish OpenAPI v1 schema matching runtime Zod validation. `docs/openapi/launchpad-v1.yaml` publishes bounded IDs, cursors, amounts, owner authorization, API-key and webhook schemas plus stable error envelopes.
- [x] Document pagination, rate limits, idempotency, event schemas, errors, and security boundaries. `LAUNCHPAD_PUBLIC_INTEGRATION.md` defines cursor/finality, status codes, webhook replay handling, browser/server boundaries and non-custodial transaction rules.
- [x] Build reusable token grid, curve trade, progress, fee, and graduation widgets. The hosted branded surface and restricted `/embed` route reuse canonical token, curve/progress, fee and graduation views with explicit origin policy.
- [x] Build a minimal independent starter application for a branded launchpad. `examples/launchpad-starter` depends only on the public SDK and `/v1/config`, with no private monorepo import or address constant.
- [x] Demonstrate create launchpad, launch token, buy, read trade, claim fee, and inspect graduation using public surfaces only. The executable `PublicLaunchpadFlow` encodes public-ABI calls for an EIP-1193 wallet, enforces chain and buy preflight, polls canonical trades by transaction hash, submits revenue claims and reads graduation without custody or private imports.
- [x] Add deterministic SDK/API contract vectors and compatibility tests. Vectors cover environment/chain mismatch, HTTPS enforcement, exact bounded request construction, limit rejection and fail-closed DLMM detection.
- [x] Document unsupported operations and DLMM capability detection. The public guide requires DAMM baseline and hides DLMM unless a compatible adapter exists in the selected manifest.
- [x] Ensure examples contain no credentials, private URLs, or hardcoded environment-specific addresses. The starter accepts only a public API URL and resolves chain, explorer and contracts at runtime.

**Exit:** the starter app completes the documented flow without importing private monorepo modules or backend secrets.

### [ ] Slice L14 — Focused security and acceptance gates (11/12, 91.7%)

**Goal:** validate the high-risk boundaries once feature implementation is complete.

- [x] Run unit/fuzz/invariant suites for registry, factory, isolation, fees, snapshots, claims, and graduation. The focused Foundry batch passed 37/37 tests, including 256 fee-conservation fuzz runs, atomic token/pool/snapshot creation, claim isolation/retry, exact-threshold DAMM graduation, versioned DLMM migration and retry-safe failure review.
- [x] Run adversarial token/reentrancy/callback/rounding/overflow scenarios. The 16/16 focused matrix rejects ERC-20 callback reentrancy, unauthorized DAMM/DLMM administration, stale/slippage-breaking execution, invalid capacity/discontinuous curves and unsafe boundaries; three inverse/coverage fuzz properties pass 256 runs each with conservative rounding.
- [x] Run upgrade/storage-layout/initializer/role/timelock checks. Seven launchpad storage baselines, initializer lock, unauthorized upgrade rejection and state-preserving upgrade pass locally; live mainnet verification now confirms every proxy implementation slot, Governance Safe default administration, 300-second timelock upgrader authority and all six least-privilege role bindings.
- [x] Run API metadata/XSS/upload/CORS/rate-limit/SSRF/webhook replay checks. The 10/10 focused API batch covers signed metadata commitment, bounded images/catalog, fixed-origin API policy, independent per-key limits, HTTPS/private-network rejection, versioned HMAC envelopes and event-ID retry/dead-letter behavior.
- [x] Run two-launchpad isolation E2E with different owners, treasuries, presets, fees, tokens, and domains. Registry/factory/token suites create independent owners and launchpad records, enforce unique slugs/presets/capacity, execute independent pools and prove trade revenue remains in isolated immutable snapshots; signed domain ownership is independently covered by the API acceptance test.
- [x] Run create → launch token → initial buy → buy/sell → claim → graduation acceptance. The combined local lifecycle batch passes 34/34 tests across canonical launch/inventory, token-pool-snapshot atomicity, buy/sell and fee routing, scoped claim/retry, exact-threshold DAMM and conditional versioned DLMM graduation.
- [x] Run ZK valid/invalid/expired/replay/wrong-domain acceptance. The 5/5 withdrawal matrix accepts exact payout and rejects altered proof, replay/nullifier reuse, unknown root, wrong chain/vault/asset/amount/recipient/relayer/deadline, malformed domain and excessive fee; toxic-token failure rolls nullifier state back.
- [x] Run DAMM recovery/retry rehearsal and DLMM acceptance only if enabled. The 8/8 graduation matrix proves exact-threshold one-time DAMM migration, persisted failures, permissionless retry/review, and enabled versioned DLMM exact-bin seeding, escrow, administration transfer and double-migration rejection.
- [x] Verify no secrets/private artifacts are tracked or exposed to browser bundles. The reproducible public-release scanner passed across 906 tracked files and 274 browser/starter files; live env/evidence/broadcast files, committed sensitive env values and browser credential patterns are rejected, while 13 intentional public proving keys are counted separately.
- [ ] Verify desktop/mobile accessibility and wallet-popup flows.
- [x] Produce reproducible receipts, accounting snapshots, manifests, and known-limitations report. `LAUNCHPAD_ACCEPTANCE_REPORT_2026-11-02.md` records exact commands, 34/34 lifecycle receipts, conservation/liability/snapshot invariants, both selected manifest states and the remaining live/timelock/UI limitations without inventing transaction hashes.
- [x] Update roadmap checkboxes only from recorded evidence. Every completed L14 checkbox points to the dated focused evidence in `LAUNCHPAD_SECURITY_ACCEPTANCE.md`; incomplete live/UI/deployment gates remain unchecked.

**Exit:** the complete feature satisfies its documented isolation, accounting, UX, and recovery acceptance gates.

### [ ] Slice L15 — Testnet deployment and manual user acceptance (0/10, 0%)

**Goal:** make the complete feature manually testable before any mainnet mutation.

- [ ] Prepare exact testnet deployment/upgrade/configuration plan, nonces, calldata hashes, gas estimate, and rollback route.
- [ ] Obtain explicit approval before broadcast.
- [ ] Deploy/configure new contracts and record complete receipts/manifests.
- [ ] Apply isolated database migration and deploy API/indexer/web only after approval.
- [ ] Create two test launchpads through the public UI from independent wallet identities where feasible.
- [ ] Launch and trade tokens on both; verify isolation, realtime chart/history/progress, fees, and claims.
- [ ] Complete DAMM graduation and optional DLMM test if enabled.
- [ ] Complete scoped ZK authorization through the web UI.
- [ ] Complete domain/webhook/SDK starter-app manual acceptance.
- [ ] Record defects, remediation, recovery rehearsal, and testnet sign-off.

**Exit:** the user can manually exercise every enabled capability through public UI/API/SDK surfaces on testnet.

### [ ] Slice L16 — Mainnet readiness and controlled rollout (9/11, 81.8%)

**Goal:** promote only the accepted capability set without disrupting existing DBC users.

- [x] Re-verify mainnet code hashes, proxies, roles, Safe/timelock, dependencies, assets, and current nonces. Live block `103850917` confirms the 2-of-2-or-stronger Safe policy, Safe nonce, 300-second timelock, proposer/executor/canceller bindings, Safe DBC administration, DBC dependency bytecode, canonical USDG symbol/decimals/code and deployer pending nonce `554`; runtime hashes are frozen in the plan.
- [x] Freeze enabled capabilities; omit DLMM or ZK operations that did not pass acceptance. The mainnet plan enables permissionless launchpads/token launches and DAMM graduation, keeps DLMM disabled by initializer, and excludes proof claims until the dedicated 15-public-input verifier exists; it explicitly refuses to reuse the unrelated Perps verifier.
- [x] Produce mainnet deployment/upgrade/config plan with per-transaction calldata, nonce, signer, gas, and total budget. Fifteen deployer transactions freeze nonces `554–568`; six governed operations freeze Safe nonces `93–98`; the fork measured `13,879,077` gas and the 20% buffered ceiling is `16,654,893` gas or `0.00033309786 ETH` at the sampled `20,000,000` wei gas price.
- [x] Simulate against a current mainnet fork and verify legacy DBC behavior/storage remains unchanged. All 15 deployments and six configurations succeeded on the block `103855367` fork; all six role bindings read true, both DBC runtime hashes stayed identical, and legacy launch/template counters were unchanged apart from the explicitly planned new role membership.
- [x] Produce release manifest, ABI/code/artifact hashes, database plan, and rollback/recovery runbook. `LAUNCHPAD_MAINNET_RELEASE_RUNBOOK.md` freezes the nonce-556 release candidate, all predicted proxy/implementation addresses, plan/fork hashes, gas envelope, additive mainnet-only migrations, service sequencing, stop conditions and reverse role-revocation recovery without modifying existing DBC proxies.
- [x] Obtain explicit broadcast approval. The owner approved exactly 15 deployments and six Governance Safe configurations under a `0.0004 ETH` total cap; database and service deployment remain separately unapproved.
- [x] Execute bounded deployment/configuration and verify every receipt/live invariant. All 21 transactions succeeded for `0.000283569999722 ETH`; seven proxy implementation slots, Lens runtime, Safe/timelock authority, final deployer nonce `577`, final Safe nonce `99` and all six role relationships were verified before receipt-derived addresses were written to the manifest.
- [x] Deploy environment-isolated API/indexer/web changes without exposing credentials. Five additive migrations applied only to `zkblast_mainnet`, 28 backend-only RLS tables verified, the mainnet DBC/Launchpad backfill recorded 40 events across 21 event blocks, API `/v1/launchpads` is live, and Cloudflare Worker version `4b147783-9520-4313-991c-64ba47db720a` serves `/launch` plus hosted launchpad routes. Public-release scanning passed with no server credential exposed.
- [x] Activate the bounded mainnet USDG/DAMM launch preset. Governance Safe transactions `0xd6661bde0cf8706eb9b80e4a1064efc37289e22d5049991ff89aec7e24ca0938` and `0x3a3e00eb826b0d7c6cfed59f489025a87c9d670521bca25d9079b56043f31936` enabled canonical USDG and preset `1`; direct onchain reads confirmed the quote allowlist, preset count and enabled flag. Total fee was `0.00000665969283 ETH` under the approved `0.00001 ETH` cap. This is supporting evidence within the existing rollout task count, not an additional checklist denominator.
- [x] Create a minimum-value canary launchpad, token, trade, fee claim, and graduation path as approved.
  - [x] Preflight the canary against live mainnet state and freeze the minimum-value launchpad/token inputs without broadcasting.
  - [x] Detect that the original non-upgradeable `VirtualPoolDeployer` predates `deployForLaunchpad`, implement an append-only factory rotation path, pass storage compatibility, and prove the 5-minute timelock upgrade plus bound-token creation on a current mainnet fork.
  - [x] Broadcast the bounded compatibility upgrade after explicit approval, then execute the canary lifecycle. The proxy address remained unchanged, all receipts passed, and the minimum-value lifecycle created launchpad `1`, launch `0x3a596648e8006f4635fe51fe1fb79a9667f234eeb9b8a78d434003ab62c1c96d`, executed buy/sell, collected and claimed fees, and graduated to DAMM for `1.008021 USDG` plus `0.000193079402564 ETH` gas.
- [ ] Monitor indexer lag, accounting, webhook delivery, RPC, errors, and user transaction failures.
- [ ] Publish accurate contract/capability documentation and known limitations.

**Exit:** mainnet supports the approved feature set with verified receipts, backward compatibility, monitoring, and recovery evidence.

**Current rollout:** compatibility upgrade and the complete canary lifecycle are live and indexed. The append-only repair retained the existing `LaunchFactory` proxy, rotated only the internal deployer for future launches, and preserved existing pools. The production API reports launchpad `1` and its graduated canary with indexer lag at zero during acceptance. Remaining L16 work is sustained monitoring and accurate public capability documentation.

## 4. Progress summary

| Slice | Status | Progress |
|---|---|---:|
| L00 Existing-system inventory | Complete | 100% |
| L01 Specification and threat model | Complete | 100% |
| L02 Registry and ownership | Complete | 100% |
| L03 Config manager and factory | Complete | 100% |
| L04 Fees and revenue splitter | Complete | 100% |
| L05 Token-launch binding | Complete | 100% |
| L06 Branding and hosted surface | Complete | 100% |
| L07 Builder and dashboard UX | Complete | 100% |
| L08 DAMM graduation | Complete | 100% |
| L09 Conditional DLMM | Complete | 100% |
| L10 Scoped ZK authorization | Active | 90.9% |
| L11 Data plane and observability | Complete | 100% |
| L12 Webhooks and developer settings | Complete | 100% |
| L13 SDK/OpenAPI/widgets/starter app | Complete | 100% |
| L14 Security and acceptance | Active | 91.7% |
| L15 Testnet manual acceptance | Not started | 0% |
| L16 Mainnet controlled rollout | Active | 81.8% |
| **Overall** | **Active** | **92.5% (173/187)** |

## 5. First execution sequence

The implementation begins with L00, then L01. No new storage-bearing contract should be written before the live/source inventory and isolation specification are complete. After those gates, the fastest safe vertical slice is:

1. Registry and factory.
2. One approved preset.
3. Existing DBC launch binding.
4. One bounded fee split.
5. Indexed API data.
6. Builder plus one hosted partner page.
7. Two-launchpad isolation demonstration.

Custom domains, webhooks, ZK authorization, and DLMM follow after that vertical path works. This ordering produces an early testable product without weakening isolation or rewriting the already functioning DBC flow.

## 6. User actions currently required

None for roadmap preparation. During L00/L01, user input is requested only if live evidence cannot determine a product choice, such as launchpad creation fee, default fee caps, owner-transfer delay, custom-domain policy, or the selected ZK-authorized action. Secrets and private keys must never be pasted into chat or committed; when a new value is required, its variable name is added to the appropriate environment example first and the user fills the private value locally.
