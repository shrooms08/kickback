# Kickback

**Your NIM pays you.** Kickback is a Nimiq Pay mini app for the Nimiq Mini Apps Competition (Cycle 3, category **Earn**).
Stake NIM once with a direct-payout pool. The pool pays you a kickback about every 12 hours, and Kickback shares each one
with your plan: send part to someone you care about, restake part, keep the rest. Your stake is never touched by the app.

- Live: https://kickback-ecru.vercel.app (open it inside Nimiq Pay)
- Mainnet and testnet, picked from the network Nimiq Pay reports
- Free, open source (MIT)

## How it works

1. **Stake once.** Pick a direct-payout pool (validators that pay rewards out to your wallet instead of restaking them),
   enter an amount, hold to stake. Nimiq Pay asks you to approve. Minimum 100 NIM.
2. **Kickbacks land about every 12h.** Kickback reads the chain to show when the next one is due (from the pool's real
   payout rhythm), what has landed, and how much is ready to share.
3. **The plan.** Drag the Stack: send X% to a contact, restake Y%, keep Z%. "Run when ready reaches" (0.10 / 1 / 5 NIM)
   waits until a run is worth its fee. "Run my plan" walks the steps: each send and restake is one approval in Nimiq Pay;
   keep needs none.
4. **Stop any time.** Stop earning (deactivate), undo while it's still inactive, withdraw after the lock, or switch pool.

**Season 1** (cosmetic only, ends Nov 30): XP earned on the server from your stake (up to 2,000 a day), plan runs, sends,
friends who stake and three weekly quests; six tiers (Spark, Kick, Bounce, Rally, Surge, Legend, three sub-levels each),
each unlocking a Stack skin; a kickback streak (shared within 24h of landing, one streak saver per week); milestones
(first stake, first kickback, first share, 10 runs, 100 NIM shared, 30-day streak, a friend who staked); a share card
(PNG, NIM only) and invite codes. XP, milestones and skins are not money and never become tokens.

Other details: the reward rate is the **Nimiq staking calculator** rate (nimiq.com/staking, ported exactly in
`src/lib/rate.ts`) minus the pool fee; calendar reminders (.ics) for the next kickback or every kickback for two weeks;
wallet picker for several basic accounts (contracts are skipped); no dollar amount below $0.01 is ever shown.

## Screenshots

Images go in `docs/screenshots/`.

| Screen | Image |
|---|---|
| Home | <!-- screenshot: home.png --> |
| Run my plan | <!-- screenshot: run-my-plan.png --> |
| Season | <!-- screenshot: season.png --> |
| Share card | <!-- screenshot: share-card.png --> |
| Pools | <!-- screenshot: pools.png --> |

## Nimiq integration

`@nimiq/mini-app-sdk` 0.2.4 (`src/services/nimiq.ts`), every call the app makes:

| Call | Used for |
|---|---|
| `init({ timeout })`, `window.nimiqPay` | Detect Nimiq Pay, get the provider |
| `getHostNetwork()` | Mainnet or testnet, once at startup |
| `listAccounts()` | Connect wallet (basic accounts only, picker when there are several) |
| `getBalance(address)` | Wallet balance (with retries while the host syncs) |
| `sign(message)` | Sign in to the backend (proves wallet ownership, moves no NIM) |
| `sendNewStakerTransaction` | First stake with a pool |
| `sendStakeTransaction` | Add stake, and the plan's restake step |
| `sendBasicTransaction` / `sendBasicTransactionWithData` | The plan's send step |
| `sendSetActiveStakeTransaction` | Stop earning (deactivate) and undo |
| `sendUpdateStakerTransaction` | Switch pool |
| `sendRetireStakeTransaction`, `sendRemoveStakeTransaction` | Withdraw |
| `NimiqProviderError` | Tell a declined approval from "not sent" and "maybe sent" |

Nimiq JSON-RPC (public nodes, rate limited client in `src/services/rpc.ts` and `supabase/functions/_shared/payouts.ts`):
`getStakerByAddress`, `getAccountByAddress`, `getValidatorByAddress`, `getActiveValidators`, `getTransactionsByAddress`,
`getTransactionByHash`, `getBlockNumber`, `getBlockByNumber`, `getBlockAfterReportingWindow`.
Nimiq Validators API: `/api/v1/validators`, `/api/v1/status`, `/api/v1/supply`. Staked ratio for the rate:
nimiq.com's `/api/staking-info`. `@nimiq/utils` for address checksums.

## Architecture

- **App:** Vue 3 + Pinia + Vite, a static bundle on Vercel. Layered screen transitions (WAAPI, transform and opacity
  only), hand-drawn hatch and skins generated once from fixed seeds (`scripts/gen-hatch.mjs`, `scripts/gen-skins.mjs`).
- **Chain reads:** the app reads stake, payouts and history straight from Nimiq RPC, cached per address for instant paint.
- **Backend (optional):** Supabase. Postgres with RLS on every table, Edge Functions on Deno:
  `auth-nonce` / `auth-verify` (wallet-signed sign-in, 30-day session), `sync` (plan, contacts, shares, events),
  `season` (XP, tiers, quests, streak, milestones, skins, invites), `xp-cron` (daily stake XP at 00:10 UTC), `pool-stats-cron` (pg_cron every 15 min per network: pool payout timing
  from the Validators API + RPC), `stats` (public totals). Without the backend the app runs local-only. See
  `docs/backend.md`.
- **Testnet:** the same app on Nimiq testnet when Nimiq Pay reports it (`docs/testnet.md`): separate RPC, Validators API,
  storage keys and database rows.

## Security

- **Never touches the stake.** The app only builds transactions you approve in Nimiq Pay; it holds no keys.
- **Signed sign-in.** The backend verifies an Ed25519 signature over a one-time nonce and that the key derives to the
  address (`supabase/functions/_shared/nimiqSignature.ts`).
- **RLS everywhere.** The anon key can only read `pool_stats`; everything else goes through Edge Functions with the
  service role, which never leaves Supabase. `e2e/rls-check.mjs` proves it.
- **Server-side validation.** Every write is validated (plans total 100, contact checksums, Luna amounts). Shares and
  stakes count only after the server finds the matching transaction on chain (sender, recipient, amount, executed); one
  transaction can prove one share. Milestones, streaks and invites are computed on the server from that verified data
  and from the chain, never from what the app claims. Public stats count only signed-in wallets and verified
  transactions.
- Preview, dry run and mock mode never sign in, never write and never earn.

**Why `verify_jwt = false`.** Every function in `supabase/config.toml` turns off the Supabase gateway JWT check on
purpose. Kickback has no Supabase Auth users, so callers never hold a Supabase Auth JWT. Sign-in is a wallet signature
instead: `auth-verify` checks the Ed25519 signature, then issues its own HS256 session JWT (signed with
`SESSION_SECRET`, 30 days). The app sends it as `Authorization: Bearer <token>`, and `sync` and `season` verify it
themselves (`supabase/functions/_shared/session.ts`). The gateway would reject that token because it is not signed with
the project's JWT secret. The cron functions (`pool-stats-cron`, `xp-cron`) check an `X-Cron-Secret` header against a
secret kept in Vault instead. `auth-nonce`, `stats` and `rpc-proxy` are public by design.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173 (Vite --host, so Nimiq Pay on the same Wi-Fi can open http://<mac-ip>:5173)
npm test           # vitest: money maths, sync rules, signatures, season maths, rate, reminders
npm run build      # vue-tsc type check + production build
```

- `http://localhost:5173/?mock=1`: fake wallet and mock data with a dev panel (dev builds only).
- `?preview=NQ..` shows live data for any address, read only (dev builds only). `?net=test` forces testnet.
- Backend: copy `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` into `.env.local`. Local stack: `supabase start`,
  `supabase functions serve --env-file <file with SESSION_SECRET>`.
- End-to-end: `node e2e/<suite>.mjs [baseUrl]` (Playwright, Android WebView emulation inside a fake Nimiq Pay).

## Layout

- `src/screens`, `src/components`, `src/stores` (Pinia), `src/services` (SDK, RPC, Validators API, chain reads),
  `src/lib` (money maths, rate, reminders, share card), `src/design` (tokens, hatch, skins)
- `supabase/migrations`, `supabase/functions`
- `design/Kickback Prototype.html`: the design source of truth
- `docs/`: SDK notes, staking lifecycle, data notes, backend, testnet
- `docs/spike/`: the read-only research spike done before the build (report and helper scripts)

## License

MIT, see `LICENSE`. The bundled Archivo font is under the SIL Open Font License 1.1, see `src/design/fonts/OFL.txt`.
