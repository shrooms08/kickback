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
3. **auth-verify** burns the nonce (one use; under 5 minutes old; same address and network), rebuilds the message from the nonce row, verifies the signature with `@noble/curves` Ed25519 over that digest (Nimcade's verifier, `supabase/functions/_shared/nimiqSignature.ts`), and checks that the public key derives to the address (Blake2b-256, first 20 bytes, IBAN-style). It upserts `users`, records a `sign_in` event and returns a **7-day JWT** (HS256, `SESSION_SECRET`) holding address and network. Tokens issued more than 7 days ago are refused whatever their `exp` says (older 30-day tokens end after 7 days; the app then asks to sign in again).
4. The token is stored per network and address (`kb:session:…`, `kb:t:session:…` on testnet). Sign-in happens once per device per network.

**Rejecting the signature:** nothing is blocked. The app stays local-only and does not ask again on its own; the Plan tab shows "Sign in to back up your plan" with a Sign in button, and Diagnostics has Sign in / Sign out. Preview mode, dry run and mock mode never sign in and never write.

## Tables (`supabase/migrations`)

| Table | Contents | Access |
|---|---|---|
| `users` | address, network, created_at, last_seen_at (unique address + network) | functions only |
| `plans` | address, network, slices (jsonb: type, percent, contact_id), plan_started_at, updated_at | functions only |
| `contacts` | id, address, network, name, contact_address, created_at (unique owner + network + contact_address) | functions only |
| `shares` | id (uuid), address, network, amount_luna (bigint), slice_type, tx_hash (null for Keep), status (confirmed / undone), created_at, reported_at (server time of the last tx, amount or type change) | functions only |
| `pool_stats` | network, validator_address, name, fee, reward_address, last_payout_at, median_interval_s, next_payout_estimate_at, payout_kind, active, elected, score, score_status, listed, payout_schedule, updated_at | **public read** |
| `events` | address (null when not signed in), network, kind, amount_luna (bigint), created_at | functions only |
| `auth_nonces` | nonce, address, network, created_at, used_at | functions only |
| `pool_probes` | known stakers per pool reward address (for cheap payout reads) | functions only |
| `invite_codes` | address, network, code (`KICK-XXXX`, unique) | functions only |
| `referrals` | invitee (one inviter per wallet per network), inviter, code, claimed_at, had_stake_at_claim, credited_at | functions only |
| `kickbacks_seen` | payouts from a direct pool's reward address to the wallet, found on chain | functions only |
| `chain_scan` | where the last history scan stopped, staked flag, scanned_at (1 chain read a minute per wallet) | functions only |
| `milestones` | address, network, key, unlocked_at (only ever added) | functions only |
| `unlocks` | Stack skins unlocked (source: default, milestone, tier), only ever added | functions only |
| `xp_ledger` | Season XP rows: source (stake, run, share, invite, quest), ref, proof, amount; unique per (wallet, season, source, ref) and per (wallet, source, proof) | functions only |
| `stake_snapshots` | each signed-in wallet's active stake once per UTC day | functions only |
| `rate_limits` | persistent rate-limit windows (key, window_start, hits, expires_at), shared by every isolate; expired rows pruned every 10 minutes | functions only |
| `cron_cursors` | where xp-cron stopped last time, per network | functions only |

RLS is on for every table. The only policy is `select` on `pool_stats` for anon/authenticated, and all default grants to anon/authenticated are revoked except that select. `e2e/rls-check.mjs` proves it with the anon key: every private read, every write and every private function gets `42501 permission denied` (23/23). `supabase db advisors`: no issues.

## Edge Functions (`supabase/functions`)

All deployed with `verify_jwt = false`: they check Kickback's own session token.

| Function | What it does |
|---|---|
| `auth-nonce` | POST `{ address, network }` → one-time nonce. Rate limited per IP and per address. |
| `auth-verify` | POST `{ address, network, nonce, publicKey, signature }` → `{ token, expiresAt }`. Rate limited per IP. |
| `sync` | GET → plan, contacts, shares. PUT `{ contacts?, plan? }` (contacts = the full list, replaced in one transaction by `kickback_replace_contacts()`: a rejected list changes nothing). POST `{ share }` (session required) or `{ event, network }` (address only with a session; anonymous events rate limited hard per IP, signed-in ones per wallet). Validates: slices total 100 with one slice per type, whole percents, a send slice names one of your contacts; contact addresses pass the Nimiq checksum and aren't your own; Luna amounts are positive safe integers; share ids are uuids, send/restake need a hash. |
| `pool-stats-cron` | POST `?network=mainnet|testnet`, only with the cron secret. See below. |
| `stats` | GET, public: totals per network for the last 7 days and all time, no addresses. Only signed-in wallets, verified stakes, and runs/shares whose tx was found on chain after the plan started. https://dhjcilstkumeglweddev.supabase.co/functions/v1/stats |
| `season` | GET (session): Season state from verified data only: invite code, streak, milestones, unlocked skins, XP, tier, weekly quests, and `kickbacks` (`[{ hash, at (ms), luna }]` since the plan started, newest first, at most 2000). POST `{ skin }` (an unlocked one), POST `{ ref }` (claim an invite code once). |
| `xp-cron` | POST `?network=…`, only with the cron secret: snapshots the active stake of wallets that can earn stake XP and have no snapshot today (a plan, an active stake at the last snapshot, or a new invitee in the last 30 days; `xp_cron_candidates()`), in address order from a cursor in `cron_cursors`, and awards daily stake XP. Hourly; each run stops after 2 minutes and the next goes on where it stopped. |
| `rpc-proxy` | POST `?network=…` with one read-only JSON-RPC request: the app's last resort when no public endpoint answers. Allowlisted methods only, 15 s cache, rate limited per IP and with a global cap on upstream calls. |

Secrets: `SESSION_SECRET` (set with `supabase secrets set`), plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` provided by Supabase. The service role key never leaves Supabase. CORS allows `https://kickback-ecru.vercel.app`, this Vercel team's previews (`https://kickback-<hash>-shrooms08s-projects.vercel.app`, `https://kickback-git-<branch>-shrooms08s-projects.vercel.app`) and localhost (`ALLOWED_ORIGINS` adds more).

**Rate limits** (one Postgres limiter, `hit_rate_limit(key, window_s, max)`, service role only; fixed windows; if the database can't answer, the call is allowed and logged). Each number can be changed with an optional function secret of that name; the defaults below apply when it is unset:

| Secret | Default | Counts |
|---|---|---|
| `AUTH_NONCE_IP_MAX` | 30 per 10 min | nonces per caller IP |
| `AUTH_NONCE_ADDRESS_MAX` | 10 per 10 min | nonces per wallet address from one caller IP (so nobody can lock an address out) |
| `AUTH_NONCE_GLOBAL_MAX` | 3000 per 10 min | nonces for everyone together (bounds how many can pile up) |
| `AUTH_VERIFY_IP_MAX` | 30 per 10 min | sign-in attempts per caller IP |
| `SYNC_ANON_EVENTS_IP_MAX` | 20 per hour | events without a session, per caller IP |
| `SYNC_EVENTS_ADDRESS_MAX` | 120 per hour | events per signed-in wallet |
| `RPC_PROXY_IP_MAX` | 60 per minute | rpc-proxy calls per caller IP (also kept per isolate) |
| `RPC_PROXY_GLOBAL_MAX` | 60 per minute | rpc-proxy calls that reach the upstream nodes, everyone together (half the public node's per-IP budget, so the crons keep theirs) |
| `RPC_PROXY_IP_UPSTREAM_MAX` | 10 per minute | of those upstream calls, per caller IP (one caller can't use the whole global cap) |
| `SEASON_WALLET_MAX` | 60 per 10 min | season reads per wallet |
| `SEASON_IP_MAX` | 300 per 10 min | season reads per caller IP |
| `INVITE_CLAIM_WALLET_MAX` | 5 per hour | invite code claims per wallet |
| `INVITE_CLAIM_IP_MAX` | 20 per hour | invite code claims per caller IP |
| `SHARES_WALLET_MAX` | 60 per 10 min | share reports per wallet |
| `SHARES_IP_MAX` | 300 per 10 min | share reports per caller IP |
| `SERVER_RPC_GLOBAL_MAX` | 60 per minute | chain calls season and sync make for users, everyone together (over it they answer from the stored state: chainOk false, shares stay unverified and are rechecked later); the crons don't count here |

The caller IP is `cf-connecting-ip` (Cloudflare sits in front of the Supabase gateway and sets it itself, replacing any value a caller sends), else the last `x-forwarded-for` hop (the local stack). `x-real-ip` and the first `x-forwarded-for` hop can be written by the caller and are never used. IPv6 callers are keyed by their /64. Over a limit the function answers 429.

season reads the chain at most once a minute per wallet: the read that wins the minute (a conditional update of `chain_scan.scanned_at`) does the chain work, parallel reads answer from the database. An invite claim is recorded before its chain check, so parallel claims lose on the unique invitee and the history is read once.

## Cron (pg_cron + pg_net)

| Job | Schedule (UTC) | Calls |
|---|---|---|
| `kickback-pool-stats-mainnet` | `*/15 * * * *` | pool-stats-cron?network=mainnet |
| `kickback-pool-stats-testnet` | `7,22,37,52 * * * *` | pool-stats-cron?network=testnet |
| `kickback-nonce-cleanup` | `30 3 * * *` | deletes nonces older than a day |
| `kickback-xp-mainnet` | `10 * * * *` | xp-cron?network=mainnet (hourly; replaced the daily `kickback-xp-daily-mainnet`) |
| `kickback-xp-testnet` | `25 * * * *` | xp-cron?network=testnet (hourly; replaced `kickback-xp-daily-testnet`) |
| `kickback-rate-limit-cleanup` | `*/10 * * * *` | deletes expired `rate_limits` windows |

The cron secret is generated inside the database (Vault, `kickback_cron_secret`) and never leaves it: pg_cron sends it as `X-Cron-Secret`, the function checks it with `cron_secret_ok()` (service role only), which compares SHA-256 digests of the two values.

**pool-stats-cron, mainnet:** every direct-payout validator from the Validators API → `getValidatorByAddress` (reward address, inactive/retired/jailed) → payout timing from a probe staker (1 RPC unit) or a scan of the reward address (5 units a page, at most 3). The batching is the app's: transactions within 10 minutes form one payout; the interval is the median gap; the next estimate is the last payout plus whole intervals. Listed non-direct validators are stored without timing (names). A run costs about 6 units and 2 seconds.
**Testnet:** every active validator (`getActiveValidators`), names from the testnet API; timing only for direct pools (Puddle; its payouts are AddStake to the staking contract, which a staker's own history doesn't show, so it is a 3-page scan, 16 units).
The RPC client keeps under the public node's limit (14 of 20 units per 10 s) and backs off on 429.

## App

- **Pools:** `pool_stats` is read first with the anon key (same selection as before: mainnet = direct, active, elected, current score, paid in 72 h; testnet = every active validator). If it is missing, older than an hour or unreachable, the app computes the list itself as before. Diagnostics shows which ("Pool list source").
- **Plans round-trip exactly:** the app's `[send, restake, keep]` and recipient map one to one onto `slices` (`src/lib/planSync.ts`); nothing is moved between slices or dropped. The recipient the screens show (the chosen contact, else the first one) is the one saved. An invalid plan (send share without a saved contact, total not 100) is rejected by the client check and by `sync` with a reason, never repaired: the phone keeps its plan, shows "Couldn't back up your plan. It's still saved on this phone." with Retry, and logs the reason in Diagnostics ("Plan backup", "Sync errors").
- **Plans, contacts, shares:** on sign-in the server wins where it has data; where it has none, local data is uploaded. Exception: if the server plan is invalid or would drop the send contact of a valid local plan, the local plan stays and is re-uploaded (with the contacts of both sides). Sign out never changes local data. Shares are kept from both sides (local ones the server lacks are uploaded). After that every change (save, add or remove a contact, undo, a confirmed run step, Keep and its Undo) is written through `sync` and cached locally. Writes go through a persisted queue: network trouble retries with backoff (2 s to 60 s, also on `online` and when the app comes back), rejected writes are dropped with the reason in Diagnostics, a 401 asks to sign in again. Dry-run shares never leave the device.
- **Events** (fire and forget, never block the UI): connect, sign_in (server side), stake, add_stake, plan_saved, run_done, stop, withdraw, switch. Without a session they are sent without an address.
- **Diagnostics:** backend, signed in, token expiry, last sync, queued writes, pool list source, Sign in / Sign out.
- Mainnet and testnet never mix: network column everywhere, separate sessions and local caches.

## Season (verification rules)

- **Shares count only when verified on chain:** the tx exists, executed, in a block, sent by the signed-in wallet, to a saved contact (send) or the staking contract (restake), for exactly the claimed amount. One tx proves one share (unique index); a verified stake tx can't also be a share. Editing a share's tx, amount or type clears its proof (trigger). The verify update only applies to the row exactly as checked.
- **Runs:** shares grouped by `run_id`, after `plan_started_at`, and a run counts only when a kickback (payout from a direct pool in `pool_stats`) landed since the last counted run. Shared NIM for milestones is capped at the kickbacks that landed.
- **Streak:** a kickback is shared on time when a counted run lands within 24h; one saver per ISO week (Monday 00:00 UTC); kickbacks before the plan started are ignored.
- **Invites:** one inviter per wallet; not your own code; it counts only if the invitee had never staked before claiming: no stake the server ever saw (stake snapshots, the scan's staked flag, a verified stake event), no stake now, and nothing to or from the staking contract in the whole tx history (read 100 at a time, up to 2,000 txs; a longer history counts as "has staked"). A tx counts as staking when the staking contract is one end and the wallet is the other end or among its `relatedAddresses`. Invite XP (+500) comes only once the invitee kept a stake of 10+ NIM for 7 UTC days, starting on the first day after the claim whose snapshot shows it (within 7 days of the claim; one day without a snapshot is tolerated; a day below 10 NIM means never), and still has it today; it is awarded on the inviter's first season read after that. The cap of 10 a season is enforced by the database: invite rows take a slot ref `invite#1`..`invite#10` (CHECK) with the invitee as proof (unique), so parallel reads can't pass it.
- **Restakes** verify only if the stake tx is no older than the latest kickback that had landed when the share was reported (an older stake shares nothing new).
- **Reported time:** `shares.reported_at` is set by the server on insert and again whenever a share's tx, amount or type change (trigger). The restake rule uses it, and run and share XP need the tx's block time within 24 hours of it, either way.
- **XP:** see `supabase/functions/_shared/xp.ts` (amounts, caps, tiers, quests, season clock) and `xpAward.ts` (awards). XP resets per season; unlocks stay.
- Unverified shares are rechecked at most 10 times within 48h, at most 50 waiting per wallet. Function RPC calls time out after 8 s and don't sleep on 429: the stored state is returned with `chainOk: false`.

## Deploying changes

**Order matters:** migrations first, then functions, then the app (the new functions read the new columns; old functions ignore them).


```bash
SUPABASE_DB_PASSWORD="$(cat ~/.kickback-supabase-db.pass)" supabase db push --linked   # migrations
supabase functions deploy <name> --project-ref dhjcilstkumeglweddev --no-verify-jwt --use-api
```

The database password is in `~/.kickback-supabase-db.pass` (mode 600, outside the repo). The app's `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are in `.env.local` (git-ignored) and in Vercel (production and preview).

## Tests

- `tests/backend.test.ts`: signature verification (known-good, tampered message, flipped signature byte, wrong key, short signature, and an address vector computed with `@nimiq/core`), app/server sign-in message match, session tokens (forged, tampered, expired), slice / contact / share / event validation, Luna maths and payout timing.
- `e2e/signin-sync.mjs`: the fake Nimiq Pay signs with a generated Ed25519 key like the host does; sign in, save a plan, clear localStorage, reload, sign in again, the plan comes back; a rejected signature leaves the app local-only with the banner; the pool list comes from pool_stats on both networks.
- `e2e/rls-check.mjs`: the anon key can't read private tables or write anything.
- `tests/season.test.ts`, `tests/xp.test.ts`: streak, milestones, skins, invite codes, tx checks, counted runs, XP formula, caps, tiers, quests, season clock.
- `e2e/season-api.mjs`, `e2e/xp-api.mjs` (local stack): spoofed shares and stakes unlock nothing, invites rules (7-day kept stake, earlier stakers don't count), skins, public stats; daily stake XP once, run caps, quests, ledger uniqueness, xp-cron secret, candidates and cursor, kickbacks since the plan started.
- `e2e/limits-api.mjs` (local stack): the Postgres rate limits of rpc-proxy (per IP, global upstream cap), auth-nonce (per IP, per address), auth-verify and sync events. Limits are seeded as full through psql, so it doesn't depend on the configured numbers; it removes its keys at the end.
- Local runs: `supabase start`, `supabase functions serve --env-file <file with SESSION_SECRET=...>`, then `node e2e/<suite>.mjs` (sync-api and season-api take a functions URL as argument, default local). `KICKBACK_ENV_FILE=<file with the local VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY> node e2e/rls-check.mjs` checks the local stack instead of `.env.local` (the local pool_stats needs one row for its read check). One run of every suite signs in about 20 wallets from one IP, under the default limits; repeated runs within 10 minutes can hit `AUTH_NONCE_IP_MAX`, so set it higher in the local env file or wait.
- `supabase/tests/season_guards.sql` (local stack): proof reset trigger, one verified share per tx, lower-case hashes.
- `tests/plansync.test.ts`, `e2e/sync-api.mjs`, `e2e/plan-roundtrip.mjs`: plans round-trip exactly (unit, Edge Function, and on screen through Sign out / Sign in / cleared storage, checked against the database row); invalid plans are rejected, not repaired; a rejected contact list leaves the stored one unchanged.
