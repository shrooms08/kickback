# Kickback — Read-only Research Spike

Data captured **2026-10-21 ~06:00 UTC** (mainnet head block ≈ 64,769,800, epoch 1420). No transactions were sent and no keys were used. The helper scripts are in this folder. They write raw responses to `data/`, which is not committed: run the scripts again for fresh data. Staker addresses from the original run are left out.

---

## VERDICT: **PASS** (just barely, with caveats)

- **2 active direct-payout pools** (Nimiq.Fun, ObsidianStake). Both are elected in the current epoch, and both paid every staker on a steady ~12 h schedule over the last 4 days. The latest payouts were 2026-10-21 00:00 and 02:30 UTC.
- **A working public mainnet RPC** (`https://rpc.nimiqwatch.com`) with `Access-Control-Allow-Origin: *`, so it can be called straight from a mini app with `setRPCUrl`.
- Caveats: only 2 pools qualify (a 3rd is listed as "direct" but has been dead since July 2025). The Validators API does **not** return `payoutAddress`. The only public RPC is community-run, "not for production", and rate-limited. See **Risks**.

---

## Validators API

| | |
|---|---|
| Base URL (mainnet) | `https://validators-api-main.je-cf9.workers.dev` (from the repo README "Dashboards → Mainnet" and the API table; confirmed with HTTP 200) |
| Testnet | `https://validators-api-test.je-cf9.workers.dev` |
| Endpoints used | `GET /api/v1/validators` (21 validators; the default is `only-known=true`), `GET /api/v1/validators?only-known=false` (80), `GET /api/v1/validators?only-known=false&payout-type=direct`, `GET /api/v1/validators/:address` (URL-encoded, with spaces), `GET /api/v1/status` (current elected/unelected/deleted sets) |
| Query params | `payout-type` (`restake`/`direct`/`none`), `only-known`, `with-identicons`, `epoch-number`, `score-version` (1 or 2), `force` — [server/utils/schemas.ts](https://github.com/nimiq/validators-api/blob/main/server/utils/schemas.ts) |
| CORS | **YES.** `access-control-allow-origin: *`, `-allow-methods: *`, `-allow-headers: *` on GET. OPTIONS returns 404 but still carries the CORS headers. A plain GET doesn't trigger a preflight, so this is fine. |
| Payload size | `/validators` is about **1.28 MB** because it includes base64 logos. Cache it and don't fetch it per render. |

Payout types on the known list: `restake` 16, `none` 2, `direct` 3. There is **no `custom` type**: the enum is only `restake | direct | none` ([types.ts](https://github.com/nimiq/validators-api/blob/main/server/utils/types.ts)).

Response fields per validator: `id, name, address, description, fee, payoutType, payoutSchedule, isMaintainedByNimiq, accentColor, website, isListed, score{total, availability, dominance, reliability, dataStatus, scoreEpoch…}, hasDefaultLogo, logo, dominanceRatio, balance (Luna), stakers`. **There is no `payoutAddress` and no "elected" flag.** For elected status, cross-check `/api/v1/status` → `validators.electedValidators`.

---

## Direct-payout pools (all of them)

`payoutAddress` comes from the raw repo file `public/validators/main-albatross/<address>.json`, cross-checked against the on-chain `rewardAddress` from RPC `getValidatorByAddress`. 1 NIM = 100,000 Luna.

| Pool | Validator address | payoutAddress (repo JSON) | On-chain rewardAddress | payoutSchedule | Fee | Trust score (v2) | Elected (epoch 1420) | Total stake | Stakers |
|---|---|---|---|---|---|---|---|---|---|
| **Nimiq.Fun** | NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU | NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717 | same as payoutAddress | `Every 12 hours` (free text, not cron) | 2.5% | **0.9998** (current) | ✅ yes | 70,880,917 NIM | 40 |
| **ObsidianStake** | NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV | *(not declared)* | = validator address | `Every 12 hours` (free text) | 5% | **0.9975** (current) | ✅ yes | 571,577,152 NIM | 153 |
| CHIPMUNK POOL | NQ32 V144 LJDN FJND NLCQ PKBU HTPF KD8G J664 | = validator address | = validator address | `0 */6 * * *` | 5% | 0.9988 in list, but **stale** (epoch 493); detail endpoint says `no_score` | ❌ unelected; `inactivityFlag` = block 23,544,000 (deactivated) | 103,199 NIM | 4 |
| Techbits Validator | NQ12 M1PJ QH7K DNAC JREU 0LD0 M4YS TQKA 751B | — | not queried | (empty) | — | `no_score` | ❌ in `deletedValidators`, `isListed:false` | — | — |

**Active direct-payout pools: 2** (Nimiq.Fun, ObsidianStake).

---

## Payout evidence (top 3 by trust score)

Method: page back through the payout address with `getTransactionsByAddress(addr, 500, startAt)`. Outgoing transfers within 1 h of each other are grouped into one payout "run", and the gaps between runs are measured. About 4 days were scanned per pool.

| Pool | Recent payouts? | Latest payout (UTC) | Interval | Txs per run | Sample tx hash | Sample recipient → amount |
|---|---|---|---|---|---|---|
| **Nimiq.Fun** | ✅ 9 runs in 4 days | **2026-10-21 02:30:02** (block 64,757,128) | **~11.95 h**. Drifts ~3 min earlier each run; looks tied to epochs (epoch ≈ 11.8 h). Seen: 10-17 02:54, 14:50; 10-18 02:48, 14:44; … 10-21 02:30 | 38 (pool has 40 stakers) | `bd7bfb209e6161fb372d96715d79207b06ef8dba847d61e060a9ca413e261a59` | a staker → **10.6036 NIM** (run total ≈ 6,225 NIM) |
| **ObsidianStake** | ✅ 8 runs in 3.75 days | **2026-10-21 00:00:13** (block 64,748,106) | **12.00 h, exactly 00:00 and 12:00 UTC** | 144–151 (pool has 153 stakers) | `83ed6076394015642f74c314d5678890a028cf381a52ce58304279dad4a72145` | a staker → **205.74176 NIM** (run total ≈ 58,512 NIM; amounts range from 0.014 to 6,688 NIM) |
| CHIPMUNK POOL | ❌ **dead** | 2025-07-07 13:00:03 (block 23,519,077) | Was hourly-ish before it stopped. Only **1** distinct recipient in the 500-tx window | 1–2 | `c7bc2b7257bab003515a3704a70d2b254cdcf877a89e8c1fb66721c64ee940ed` | a staker → 209.63523 NIM |

The staker-side view was cross-checked: `getTransactionsByAddress(<sample recipient>, 50, null)` returned 50/50 transactions sent from the pool's payout address, every 12 h. This is the cheap query a mini app would make.

---

## RPC

| | |
|---|---|
| Endpoint | **`https://rpc.nimiqwatch.com`** (mainnet; maintainer "sisou"). This is the **only** mainnet entry in the list the dev center shows on `/rpc/open-servers`. That list is loaded from [nimiq/awesome `src/data/dist/rpc-servers.json`](https://github.com/nimiq/awesome/blob/main/src/data/dist/rpc-servers.json) via [developer-center `server/api/rpc-servers.get.ts`](https://github.com/nimiq/developer-center/blob/main/server/api/rpc-servers.get.ts). Testnet: `https://rpc.testnet.nimiqwatch.com/` |
| Spec | OpenRPC v2.1.0 ([developer-center `data/openrpc-document.json`](https://github.com/nimiq/developer-center/blob/main/data/openrpc-document.json)) |
| Methods that worked | `getBlockNumber`, `getValidatorByAddress`, `getTransactionsByAddress`, `getStakerByAddress`, `getAccountByAddress`, `getTransactionByHash` |
| Gotcha | `getTransactionsByAddress` **requires all 3 params**: `[address, max, startAt]`. Pass `null` for `startAt`, or it errors with `-32602 invalid length 2`. Paginate by passing the last tx hash as `startAt`. |
| Response envelope | `{"jsonrpc":"2.0","result":{"data":…,"metadata":null},"id":1}`. The mini-app `request()` returns only `result.data`. |
| CORS | **YES.** Preflight `OPTIONS` → 204 with `access-control-allow-origin: *`, `-allow-methods: POST`, `-allow-headers: content-type`. POST → 200 with `access-control-allow-origin: *`. |
| Rate limit | `x-ratelimit-remaining` / `x-ratelimit-reset` headers. The budget was **20 units per ~10 s window** (per IP, presumably). `getBlockNumber` and `getTransactionsByAddress(max=50)` cost 1 unit each; `getTransactionsByAddress(max=500)` cost **5**. Going over gives **HTTP 429** `{"error":"Rate limit exceeded"}`, which I hit during the spike. |

`getStakerByAddress("<staker address>")` (an ObsidianStake recipient):

```json
{
  "address": "<staker address>",
  "balance": 170441199815,          // active stake, Luna (= 1,704,412 NIM)
  "delegation": "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV",
  "inactiveBalance": 0,
  "inactiveFrom": null,              // block height when inactive stake was set
  "retiredBalance": 0
}
```

Fields: `address, balance, delegation, inactiveBalance, inactiveFrom, retiredBalance`. There's no field for pending or accrued rewards, because rewards are paid off-chain by the pool. The liquid wallet balance comes from a separate call: `getAccountByAddress` → `{"address":…,"balance":2915136561,"type":"basic"}`.

`getValidatorByAddress` returns `address, signingKey, votingKey, rewardAddress, signalData, balance, numStakers, inactivityFlag, retired, jailedFrom`. **`rewardAddress` is the on-chain way to find the payout address.**

---

## Minimum stake

**100 NIM** (`MINIMUM_STAKE = 10_000_000` Luna). It applies to the non-retired balance (active + inactive) and to the total balance, whenever either is non-zero.

- Code: [core-rs-albatross `primitives/src/policy.rs` L136–140 @ 71ccd45](https://github.com/nimiq/core-rs-albatross/blob/71ccd45aa8c2324128ffedf77ecb470a1884c96c/primitives/src/policy.rs#L136-L140)
- Docs: [nimiq.dev Protocol › Stakers](https://github.com/nimiq/developer-center/blob/main/content/protocol/validators/stakers.md) ("The initial stake (minimum 100 NIM)…") and [Staking FAQ](https://github.com/nimiq/developer-center/blob/main/content/nodes/validators/staking-faq.md) ("a minimum of 100 NIM is required").
- For reference, the validator deposit is 100,000 NIM (`VALIDATOR_DEPOSIT = 10_000_000_000` Luna).

---

## Risks and surprises

1. **Only 2 real direct-payout pools.** A Payday design built on direct payouts has a candidate set of exactly 2. If either one changes its payout type, goes offline or gets jailed, the app has a single pool. Both are healthy right now (score ≥ 0.997, elected, 12 h cadence). The other 16 known pools are `restake`, where rewards compound inside the stake and no payout transaction appears. Detecting "payday" for restake stakers would mean diffing `getStakerByAddress.balance` over time.
2. **The Validators API does not return `payoutAddress`**, even though the README and the example template define it. Its zod schema drops the field. Options: (a) use RPC `getValidatorByAddress(...).rewardAddress` (correct for both live pools today), (b) read the raw repo JSON from GitHub, or (c) hardcode it. ObsidianStake doesn't declare a payoutAddress at all, and it pays from its validator address. Don't rely on the declared field.
3. **Stale metadata.** CHIPMUNK POOL is still `isListed:true, payoutType:"direct"` in the default list, but it was deactivated on-chain in July 2025 and hasn't paid since. The list's `score` for it is a stale epoch-493 value (`dataStatus:"stale"`). **Filter on `score.dataStatus === "current"` plus membership in `/status` `electedValidators`** (or `inactivityFlag == null`), not just `payoutType`.
4. **`payoutSchedule` is free text.** Two pools use `"Every 12 hours"`, not cron, despite the README saying cron. Infer the schedule from observed transaction timing; don't parse the field.
5. **Some payouts are AddStake, not transfers.** Nimiq.Fun sent 7 of its 38 latest payouts, and ObsidianStake 3 of 137, to the staking contract `NQ77 0000 0000 0000 0000 0000 0000 0000 0001` with `recipientData` starting `0x06` (AddStake). The actual staker is encoded in `recipientData` and appears in `relatedAddresses`. Stakers who opted to restake won't see a transfer `to` their address. Scanning by the staker's address still finds these (via `relatedAddresses`), but check `to`/`toType`.
6. **Not every staker gets paid every run.** Nimiq.Fun paid 38 of 40 stakers, ObsidianStake 144–151 of 153. Likely reasons: new or just-joined stakers, or dust thresholds. Don't promise a payout every cycle.
7. **No claim step was observed.** Both pools push payouts automatically on schedule; nothing suggests rewards are only paid when claimed. Payouts are deterministic (ObsidianStake at exactly 00:00 and 12:00 UTC; Nimiq.Fun about every 11.95 h). "Next payday" countdowns are feasible.
8. **RPC fragility.** There is one public mainnet RPC, community-run, labelled "not suitable for production… no uptime guarantees… may experience throttling". The rate limit is 20 units per ~10 s, and large `max` values cost more. A per-user mini app making 1–2 small calls (`max ≤ 50`) is fine. Scanning a pool's whole payout history from the client is not: a payout address gets about 1,500 coinbase reward inherents per day, so 500 transactions only cover about 3–6 h. **Query the user's own address, not the pool's.** Keep a backend fallback, or run your own RPC node.
9. **Units.** All balances and values are in **Luna** (÷ 100,000 for NIM). The Validators API `balance` is also in Luna.
10. **Large payload.** The Validators API `/validators` response is about 1.28 MB with logos. Cache it server-side, or fetch it once and strip logos.

---

## Raw commands used

All scripts are in this folder (`docs/spike/`) and use Node 24 (Node 18+ works) with built-in `fetch`. They are read-only.

```bash
# 1. Validators API (README -> base URL), with CORS origin header
curl -sL https://raw.githubusercontent.com/nimiq/validators-api/main/README.md
curl -s -D - -H "Origin: https://example.vercel.app" \
  "https://validators-api-main.je-cf9.workers.dev/api/v1/validators" -o data/validators.json
curl -s "https://validators-api-main.je-cf9.workers.dev/api/v1/validators?only-known=false&payout-type=direct"
curl -s "https://validators-api-main.je-cf9.workers.dev/api/v1/validators/NQ32%201U9X%207P3X%20B2H5%20XA00%205LC2%205KFE%20VBQE%20X3BU"
curl -s "https://validators-api-main.je-cf9.workers.dev/api/v1/status" > data/status.json
curl -s -D - -o /dev/null -X OPTIONS -H "Origin: https://example.vercel.app" -H "Access-Control-Request-Method: GET" \
  "https://validators-api-main.je-cf9.workers.dev/api/v1/validators"
# schema / types / raw validator files (payoutAddress lives only here)
curl -sL https://raw.githubusercontent.com/nimiq/validators-api/main/server/utils/schemas.ts
curl -sL "https://raw.githubusercontent.com/nimiq/validators-api/main/public/validators/main-albatross/NQ32%201U9X%207P3X%20B2H5%20XA00%205LC2%205KFE%20VBQE%20X3BU.json"

# 2. Public RPC discovery
curl -sL https://raw.githubusercontent.com/nimiq/developer-center/main/server/api/rpc-servers.get.ts
curl -sL https://raw.githubusercontent.com/nimiq/awesome/main/src/data/dist/rpc-servers.json
curl -sL https://raw.githubusercontent.com/nimiq/developer-center/main/data/openrpc-document.json

# 3. RPC + CORS
curl -s -D - -X OPTIONS https://rpc.nimiqwatch.com -H "Origin: https://example.vercel.app" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
curl -s -D - https://rpc.nimiqwatch.com -H "Origin: https://example.vercel.app" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBlockNumber","params":[]}'
curl -s https://rpc.nimiqwatch.com -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getTransactionsByAddress","params":["<staker address>",50,null]}'
curl -s https://rpc.nimiqwatch.com -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getStakerByAddress","params":["<staker address>"]}'

# Node helpers (docs/spike/)
cd docs/spike
node validators.mjs                       # getValidatorByAddress for the 3 direct pools -> rewardAddress, inactivityFlag
node payouts.mjs                          # latest 500 txs per payout address
node payout_history.mjs "Nimiq.Fun"     "NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717" 4   # paginated, payout runs + gaps
node payout_history.mjs "ObsidianStake" "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV" 4
node staker.mjs "<staker address>"       # getStakerByAddress / getAccountByAddress / AddStake payout tx
node staker_view.mjs "<staker address>" "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV"   # payouts as seen from the staker's own address

# 6. Minimum stake
curl -sL https://raw.githubusercontent.com/nimiq/core-rs-albatross/albatross/primitives/src/policy.rs | grep -n -A2 MINIMUM_STAKE
```
