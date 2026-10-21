# Backend (Supabase)

Project **kickback**, ref `dhjcilstkumeglweddev`, region eu-west-1. Dashboard: https://supabase.com/dashboard/project/dhjcilstkumeglweddev

Supabase is the source of truth for plans, contacts and processed shares. localStorage stays the offline cache. The app works fully without the backend: no env vars, a declined signature, preview, dry run or offline all mean local-only, exactly as before.

## Sign in with the wallet

1. After Connect wallet (once live data has loaded) the app calls **auth-nonce** `{ address, network }` and gets `{ nonce, issuedAt }`.
2. It asks the wallet to sign this text with the SDK's `sign()`:

   ```
   Sign in to Kickback
   Address: NQ.. .... ....
   Network: mainnet
   Nonce: <32 hex>
   Issued: <ISO time>

   This only proves you own this wallet. It does not move any NIM.
   ```

   `sign()` returns `{ publicKey, signature }` as hex. Nimiq Pay signs SHA-256 of `"\x16Nimiq Signed Message:\n" + <byte length> + message` with Ed25519 (nimiq-pay-app `src/composables/useMiniAppHost.ts`).
3. **auth-verify** burns the nonce (one use; under 5 minutes old; same address and network), rebuilds the message from the nonce row, verifies the signature with `@noble/curves` Ed25519 over that digest (Nimcade's verifier, `supabase/functions/_shared/nimiqSignature.ts`), and checks that the public key derives to the address (Blake2b-256, first 20 bytes, IBAN-style). It upserts `users`, records a `sign_in` event and returns a **30-day JWT** (HS256, `SESSION_SECRET`) holding address and network.
4. The token is stored per network and address (`kb:session:…`, `kb:t:session:…` on testnet). Sign-in happens once per device per network.

**Rejecting the signature:** nothing is blocked. The app stays local-only and does not ask again on its own; the Plan tab shows "Sign in to back up your plan" with a Sign in button, and Diagnostics has Sign in / Sign out. Preview mode, dry run and mock mode never sign in and never write.

## Tables (`supabase/migrations`)

| Table | Contents | Access |
|---|---|---|
| `users` | address, network, created_at, last_seen_at (unique address + network) | functions only |
| `plans` | address, network, slices (jsonb: type, percent, contact_id), plan_started_at, updated_at | functions only |
| `contacts` | id, address, network, name, contact_address, created_at (unique owner + network + contact_address) | functions only |
| `shares` | id (uuid), address, network, amount_luna (bigint), slice_type, tx_hash (null for Keep), status (confirmed / undone), created_at | functions only |
| `pool_stats` | network, validator_address, name, fee, reward_address, last_payout_at, median_interval_s, next_payout_estimate_at, payout_kind, active, elected, score, score_status, listed, payout_schedule, updated_at | **public read** |
| `events` | address (null when not signed in), network, kind, amount_luna (bigint), created_at | functions only |
| `auth_nonces` | nonce, address, network, created_at, used_at | functions only |
| `pool_probes` | known stakers per pool reward address (for cheap payout reads) | functions only |

RLS is on for every table. The only policy is `select` on `pool_stats` for anon/authenticated, and all default grants to anon/authenticated are revoked except that select. `e2e/rls-check.mjs` proves it with the anon key: every private read and every write gets `42501 permission denied` (20/20). `supabase db advisors`: no issues.

## Edge Functions (`supabase/functions`)

All deployed with `verify_jwt = false`: they check Kickback's own session token.

| Function | What it does |
|---|---|
| `auth-nonce` | POST `{ address, network }` → one-time nonce |
| `auth-verify` | POST `{ address, network, nonce, publicKey, signature }` → `{ token, expiresAt }` |
| `sync` | GET → plan, contacts, shares. PUT `{ contacts?, plan? }` (contacts = the full list). POST `{ share }` (session required) or `{ event, network }` (address only with a session). Validates: slices total 100 with one slice per type, whole percents, a send slice names one of your contacts; contact addresses pass the Nimiq checksum and aren't your own; Luna amounts are positive safe integers; share ids are uuids, send/restake need a hash. |
| `pool-stats-cron` | POST `?network=mainnet|testnet`, only with the cron secret. See below. |
| `stats` | GET, public: totals per network for the last 7 days and all time, no addresses. https://dhjcilstkumeglweddev.supabase.co/functions/v1/stats |

Secrets: `SESSION_SECRET` (set with `supabase secrets set`), plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` provided by Supabase. The service role key never leaves Supabase. CORS allows `https://kickback-ecru.vercel.app`, `https://kickback-*.vercel.app` and localhost (`ALLOWED_ORIGINS` adds more).

## Cron (pg_cron + pg_net)

| Job | Schedule (UTC) | Calls |
|---|---|---|
| `kickback-pool-stats-mainnet` | `*/15 * * * *` | pool-stats-cron?network=mainnet |
| `kickback-pool-stats-testnet` | `7,22,37,52 * * * *` | pool-stats-cron?network=testnet |
| `kickback-nonce-cleanup` | `30 3 * * *` | deletes nonces older than a day |

The cron secret is generated inside the database (Vault, `kickback_cron_secret`) and never leaves it: pg_cron sends it as `X-Cron-Secret`, the function checks it with `cron_secret_ok()` (service role only).

**pool-stats-cron, mainnet:** every direct-payout validator from the Validators API → `getValidatorByAddress` (reward address, inactive/retired/jailed) → payout timing from a probe staker (1 RPC unit) or a scan of the reward address (5 units a page, at most 3). The batching is the app's: transactions within 10 minutes form one payout; the interval is the median gap; the next estimate is the last payout plus whole intervals. Listed non-direct validators are stored without timing (names). A run costs about 6 units and 2 seconds.
**Testnet:** every active validator (`getActiveValidators`), names from the testnet API; timing only for direct pools (Puddle; its payouts are AddStake to the staking contract, which a staker's own history doesn't show, so it is a 3-page scan, 16 units).
The RPC client keeps under the public node's limit (14 of 20 units per 10 s) and backs off on 429.

## App

- **Pools:** `pool_stats` is read first with the anon key (same selection as before: mainnet = direct, active, elected, current score, paid in 72 h; testnet = every active validator). If it is missing, older than an hour or unreachable, the app computes the list itself as before. Diagnostics shows which ("Pool list source").
- **Plans, contacts, shares:** on sign-in the server wins where it has data; where it has none, local data is uploaded. Shares are kept from both sides (local ones the server lacks are uploaded). After that every change (save, add or remove a contact, undo, a confirmed run step, Keep and its Undo) is written through `sync` and cached locally. Writes go through a persisted queue: network trouble retries with backoff (2 s to 60 s, also on `online` and when the app comes back), rejected writes are dropped with the reason in Diagnostics, a 401 asks to sign in again. Dry-run shares never leave the device.
- **Events** (fire and forget, never block the UI): connect, sign_in (server side), stake, add_stake, plan_saved, run_done, stop, withdraw, switch. Without a session they are sent without an address.
- **Diagnostics:** backend, signed in, token expiry, last sync, queued writes, pool list source, Sign in / Sign out.
- Mainnet and testnet never mix: network column everywhere, separate sessions and local caches.

## Deploying changes

```bash
SUPABASE_DB_PASSWORD="$(cat ~/.kickback-supabase-db.pass)" supabase db push --linked   # migrations
supabase functions deploy <name> --project-ref dhjcilstkumeglweddev --no-verify-jwt --use-api
```

The database password is in `~/.kickback-supabase-db.pass` (mode 600, outside the repo). The app's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are in `.env.local` (git-ignored) and in Vercel (production and preview).

## Tests

- `tests/backend.test.ts`: signature verification (known-good, tampered message, flipped signature byte, wrong key, short signature, and an address vector computed with `@nimiq/core`), app/server sign-in message match, session tokens (forged, tampered, expired), slice / contact / share / event validation, Luna maths and payout timing.
- `e2e/signin-sync.mjs`: the fake Nimiq Pay signs with a generated Ed25519 key like the host does; sign in, save a plan, clear localStorage, reload, sign in again, the plan comes back; a rejected signature leaves the app local-only with the banner; the pool list comes from pool_stats on both networks.
- `e2e/rls-check.mjs`: the anon key can't read private tables or write anything.
