# Nimiq RPC endpoints

Kickback never depends on one community node. Every read goes through an ordered list per network
(`src/lib/net.ts`, server side `supabase/functions/_shared/rpcEndpoints.ts`):

1. **JSON-RPC nodes** in order (first healthy one wins).
2. **REST fallback** (mainnet): the Nimiq.Watch REST API, for the methods it can answer (`src/lib/restAdapter.ts`).
3. **Kickback rpc-proxy** (Supabase Edge Function): read-only allowlist, server-side endpoints (also ones without CORS), 15 s cache, per-IP rate limit.

Failover on network errors, timeouts (8 s; 3 s for the start-up health check), HTTP 5xx, 429 and non-JSON
replies. A valid JSON-RPC answer is never a failure, even "No staker with address". A failed endpoint is
tried again after 60 s. Each endpoint has its own rate limiter. Diagnostics shows the URLs, the active
endpoint and each one's state, latency and last error. If everything fails the app shows its cache with
"Network data is delayed" (degraded mode); the error screen only appears with no cache and no answer from
Nimiq Pay either.

## What was found (2026-10-28, ~17:20 UTC, tested from Node and from Chromium with Origin https://kickback-ecru.vercel.app)

| Endpoint | Type | Source / evidence | Status | Browser (CORS) | Methods |
|---|---|---|---|---|---|
| `https://rpc.nimiqwatch.com` | JSON-RPC, mainnet | nimiq/awesome `rpc-servers.json` (the only mainnet entry), developer-center "open servers" | **Down**: HTTP 503 (Coolify "application not available", since about Oct 26) | `Access-Control-Allow-Origin: *` when up | all (20 units / 10 s per IP when up) |
| `https://rpc-mainnet.nimiqscan.com` | JSON-RPC, mainnet | NimFeed, GoPool and nimble configs; NimiqScan "free public RPC, best effort" | **Down**: HTTP 530 (Cloudflare 1033, origin offline) | not testable while down | not testable |
| `https://v2.nimiqwatch.com/api` | REST, mainnet | nimiq/wallet `config.mainnet.ts`, nimiq/prestaking-website | **Up** | `*` (GET) | block height, account, staker (same shape as JSON-RPC), latest 20 transactions of an address, transaction by hash, block by height. No validators, active validators, reporting window, history paging. |
| `https://rpc.testnet.nimiqwatch.com` | JSON-RPC, testnet | nimiq/awesome | **Up** | `*` | all |
| `https://rpc-testnet.nimiqscan.com` | JSON-RPC, testnet | NimiqScan | **Down** (530) | | |

About 25 other guessed hostnames (rpc.nimiq.com, mainnet.nimiq.network, rpc.nimiq.network, …) have no DNS
record. No other public mainnet JSON-RPC turned up in GitHub code search, nimiq/awesome, the developer
center or web search. nimiq/validators-api keeps its node URL private; nimiq/wallet uses the `@nimiq/core`
light client over WebSocket seed nodes instead of JSON-RPC. Inside Nimiq Pay, `getBalance` and
`getBlockNumber` come from the host (SDK), not from any public RPC.

## What the REST fallback cannot do, and how the app copes

- **Validator details** (reward address, inactive/jailed): reward addresses come from Supabase
  `pool_stats`, or from a known probe staker of a direct pool (it delegates to the validator and is paid from
  its reward address: `rewardOf()` in `src/services/chain.ts`, `fallbackRewards()` in pool-stats-cron).
  The cron keeps the last good values instead of writing nulls when it can't read validators.
- **Epoch timing** (`getBlockAfterReportingWindow`, election blocks): the payout-based estimate stands in.
- **Full history**: only the latest 20 transactions, so "Earned" may show less while only REST works.

## Adding an endpoint

Put it in `rpcUrls` in `src/lib/net.ts` (needs CORS) and/or `PUBLIC_RPC` in
`supabase/functions/_shared/rpcEndpoints.ts`. A node without CORS, or a private one, goes only server side:
`supabase secrets set RPC_MAINNET_URLS=https://node.example` (comma-separated). Re-test with
`node e2e/rpc-failover.mjs` and Diagnostics.
