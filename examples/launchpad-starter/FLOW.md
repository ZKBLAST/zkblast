# Public-surface flow

1. Load `/v1/config`, validate it with `resolveLaunchpadApiRuntime`, then resolve
   contracts from the matching public deployment manifest.
2. Prepare `LaunchpadClient.createLaunchpad(...)` and submit it with the user's
   wallet. Wait for its receipt and read the indexed launchpad record.
3. Prepare `LaunchpadClient.createToken(...)`; the wallet submits the launch and
   optional initial buy as explicit transactions.
4. Request a bounded quote through `LaunchpadApiClient.quote(...)`, run
   `assertDbcPreflight(...)`, then submit `DbcClient.buyExactInput(...)` or its
   sell equivalent with the wallet.
5. Read the stable-cursor trade feed until the transaction hash is indexed.
6. Prepare fee collection/claim using `LaunchpadClient.collectTradeFees(...)`
   and the public revenue helpers; submit with the entitled wallet.
7. Read graduation state and call `launchpadCapabilities(...)`. Show DAMM by
   default and DLMM only when the selected manifest exposes its adapter.

No step requires a private backend import, service-role credential, relayer key,
or hardcoded contract address.
