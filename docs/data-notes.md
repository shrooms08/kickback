# Live data notes (Phase 2)

Checked against real mainnet responses on 2026-10-21 (head block ≈ 64,785,800, epoch 1420).
Everything is read-only. 1 NIM = 100,000 Luna. All balances and values are in Luna.

## Sources

| What | Where | Notes |
|---|---|---|
| Pools | Validators API `https://validators-api-main.je-cf9.workers.dev` | CORS `*`. Responses embed base64 logos, so they're trimmed before caching. |
| Chain | JSON-RPC `https://rpc.nimiqwatch.com` | CORS `*`. About 20 units per 10 s per IP. |
| Wallet balance | SDK `getBalance(address)` inside Nimiq Pay | In preview mode, RPC `getAccountByAddress` instead. |

## Validators API

### `GET /api/v1/validators?payout-type=direct&only-known=false` (≈380 KB, 4 validators)

Per validator (logo and description dropped):

```json
{ "id": 21, "name": "Nimiq.Fun", "address": "NQ32 1U9X 7P3X B2H5 XA00 5LC2 5KFE VBQE X3BU",
  "fee": 0.025, "payoutType": "direct", "payoutSchedule": "Every 12 hours", "isMaintainedByNimiq": false,
  "accentColor": "#FFD233", "website": "https://nimiq.fun", "isListed": true,
  "score": { "scoreVersion": 2, "total": 0.999788757341703, "availability": 1, "recentAvailability": 1,
             "longTermAvailability": 1, "dominance": 0.9999999997943506, "reliability": 0.999788757547309,
             "epochNumber": 1419, "scoreEpoch": 1419, "dataStatus": "current", "recentCoverage": 1,
             "longTermCoverage": 1, "longTermAsOfEpoch": 1419 },
  "hasDefaultLogo": false, "dominanceRatio": 0.007666228673956606, "balance": 7088091673249, "stakers": 40 }
```

The 4 returned: Nimiq.Fun (2.5%, score 0.9998 current), ObsidianStake (5%, 0.9975 current),
CHIPMUNK POOL (5%, 0.9988 but `dataStatus: "stale"`, epoch 493), Techbits Validator (1%, `no_score`, unlisted).

### What the API provides
- **Score:** yes. `score.total` is 0 to 1, with `dataStatus` set to `current`, `stale` or `no_score`.
- **APY or reward rate:** no. No field for it on any endpoint.
- **Payout schedule:** only as free text (`"Every 12 hours"`, `"0 */6 * * *"`, `""`). Not usable, so the schedule is measured from payouts.
- **Payout address:** no. It comes from RPC `getValidatorByAddress().rewardAddress`.
- **Elected / active:** not on the validator. Use `/status`.
- **Stakers, balance (Luna), fee (0 to 1), name, website, accentColor:** yes.

### `GET /api/v1/status` (≈15 KB)
`validators.electedValidators` / `unelectedValidators`: `[{ address, balance, elected, dominanceRatioViaBalance, dominanceRatioViaSlots, missed, rewarded, stakers, likelihood }]`,
`validators.deletedValidators: string[]`, `validators.epochNumber`, plus `range`, `scoreStatus`, `blockchain.headBlockNumber`.

### `GET /api/v1/supply`
`{ "total": 1462652862244536, "vested": …, "burned": …, "max": 2100000000000000, "initial": …, "staking": 929614651697843, "minted": …, "circulating": …, "mined": … }` (Luna).

### Others
`GET /api/v1/validators` (known list, all payout types) is **1.28 MB**: 21 validators, 99% of it logos (16 restake, 3 direct, 2 none).
Kickback only fetches it to name a pool that isn't direct, and caches it trimmed for 24 h.
`GET /api/v1/validators/:address` is 620 KB because it includes every epoch's score. Not used.

## RPC (rpc.nimiqwatch.com)

Every response is wrapped as `{ "jsonrpc": "2.0", "result": { "data": …, "metadata": … }, "id": 1 }`.
Measured costs from `x-ratelimit-remaining`: `getBlockNumber`, `getStakerByAddress`, `getAccountByAddress`,
`getValidatorByAddress` and `getTransactionsByAddress` with max 25 or 100 all cost **1 unit**. Max 500 costs **5** (from the spike).
`getStakersByValidatorAddress` is **blocked** on this node (`{"error":"Method not allowed"}`, HTTP 400).

`getStakerByAddress(address)`:
```json
{ "address": "NQ11 NMR7 4E14 CD4Q 3YEQ DJ67 5L6G YAM7 RNF4", "balance": 5000000000000,
  "delegation": "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV", "inactiveBalance": 2500000000000,
  "inactiveFrom": 54043200, "retiredBalance": 0 }
```
Not a staker: `{"error":{"code":-32603,"message":"Internal error","data":"No staker with address: NQ…"}}`. The client returns `null` for this.

`getAccountByAddress(address)`: `{ "address": "…", "balance": 159887595809, "type": "basic" }`

`getValidatorByAddress(validator)`:
`{ address, signingKey, votingKey, rewardAddress, signalData, balance, numStakers, inactivityFlag: null, retired: false, jailedFrom: null }`.
Nimiq.Fun pays from `NQ16 373T EQ2V JX5B ME74 G056 3TA9 75L3 P717`. ObsidianStake pays from its validator address.

`getTransactionsByAddress(address, max, startAt)`: needs all 3 params, so pass `null` for the newest page and a tx hash to page back. Newest first.
```json
{ "hash": "7ce3…31b9", "blockNumber": 64748103, "timestamp": 1792540810274, "confirmations": 37671, "size": 139,
  "relatedAddresses": ["NQ15 5JNS …7TSV", "NQ11 NMR7 …RNF4"], "from": "NQ15 5JNS U7CE RAH5 3T02 F8A9 JCT6 QMG9 7TSV",
  "fromType": 0, "to": "NQ11 NMR7 4E14 CD4Q 3YEQ DJ67 5L6G YAM7 RNF4", "toType": 0, "value": 609707745, "fee": 0,
  "senderData": "", "recipientData": "", "flags": 0, "validityStartHeight": 64748102, "proof": "…", "networkId": 24,
  "executionResult": true }
```

`getBlockAfterReportingWindow(54043200)` returns `54086401` (one epoch later, 43,200 blocks). `getBlockNumber` returns the head height. Blocks are 1 s apart (`getPolicyConstants.blockSeparationTime = 1000`).

## How Kickback derives things

- **Pools shown** must pass all of these:
  1. `payoutType === "direct"`
  2. Listed in `/status` electedValidators
  3. `score.dataStatus === "current"`
  4. Healthy on chain (`inactivityFlag`, `retired` and `jailedFrom` all empty)
  5. At least one payout in the last 72 h

  Today that leaves Nimiq.Fun and ObsidianStake. CHIPMUNK POOL and Techbits drop out at step 2 (not elected), before the 72 h check.
- **Reward address:** `getValidatorByAddress(validator).rewardAddress`, cached for 24 h.
- **Kickback:** a transaction where `from` is a reward address of a pool shown, or of the user's own pool, and either `to` is the user or `relatedAddresses` contains the user. The second case catches payouts sent as AddStake to the staking contract, which are flagged `restaked`.
- **History:** `getTransactionsByAddress(address, 100, startAt)`, paging back until 30 days are covered or history ends (at most 6 pages). Older pages are cached for a week, because they never change.
- **Batches and interval:** payout times within 10 minutes are grouped into one batch. The interval is the median gap between batches.
- **Schedule label:** if every batch lands within 3 minutes of the same whole UTC hours, it reads "00:00 and 12:00 UTC". Otherwise "About every Nh".
- **Trust out of 10:** `round(score.total × 10)` when the score is current. Today both pools are **10 / 10** (0.9998 and 0.9975).
  The fallback when there's no current score: `5` (active and elected) `+ 2 × max(0, 1 − fee / 10%)` `+ 3 × max(0, 1 − sd(gaps) / median gap)`, rounded.
- **Estimated earnings** (always shown with "about"):
  - From `policy.rs`, the remaining supply decays by `SUPPLY_DECAY = 0.9999999999960264` per ms.
  - So next year's emission is `(TOTAL_SUPPLY − supply.total) × (1 − DECAY^msPerYear)`.
  - The gross rate is that emission divided by `supply.staking`. Today that's **8.08%**, so after fees Nimiq.Fun is about 7.88% and ObsidianStake about 7.68%.
  - Per kickback is the stake × net rate ÷ payouts per year (8,760h ÷ interval).
- **Ready to share** (until Phase 3): kickbacks from the last 24 h. **Earned so far:** every kickback found in the 30 days scanned.
- **Countdown:**
  - The next kickback is due at the last own kickback (or the pool's last payout) + the interval.
  - The 12-segment bar shows the elapsed share of the interval.
  - More than 2 h overdue shows "Running late". More than 36 h since the pool's last payout shows the "hasn't paid" banner.
- **Unstaking card:** shown when `inactiveBalance + retiredBalance > 0`.
  - It becomes withdrawable at `getBlockAfterReportingWindow(inactiveFrom)`, converted to a time using the head block (1 s per block).
  - If there's still active stake, the countdown stays and the card appears below it.

### Pool payout health: probes, not the reward address
The reward address also receives a coinbase reward inherent roughly every minute (60 to 80 an hour).
So 25 transactions from it cover about 20 minutes, 100 cover about 1.5 h, and 500 cover only 6 to 8 h.
"Most recent outgoing transaction in the last 25" almost never finds a payout. Instead:

1. Read a **probe**: a known staker of that pool. `getTransactionsByAddress(probe, 25, null)` costs 1 unit and covers about 12 days of payouts.
   Probes are the seed test addresses below, plus ones learned at runtime (the user's own address when they're in that pool, and the biggest recipient found by a scan).
   Results are cached for 15 min.
2. If no probe has a payout from that reward address in the last 72 h, **scan** the reward address in pages of 500 (5 units each).
   It stops after two batches or 72 h of coverage, and learns a new probe from the batch it finds.
3. The user's own pool uses the user's own kickbacks once there are at least 3 batches. No extra call.

## Test addresses (real stakers receiving direct payouts)

| Pool | Address | Stake | Notes |
|---|---|---|---|
| Nimiq.Fun | `NQ03 J45B 27LT QHD7 2PRM 73QP SB15 LM6H VCR8` | 32,000,000 NIM | 25 of 25 recent txs are payouts, every 11.95 h |
| Nimiq.Fun | `NQ33 VCNC TLSY 10X3 BKJ7 NSY1 B6F6 R0J9 1SUK` | 8,888,888 NIM | Same rhythm |
| ObsidianStake | `NQ11 NMR7 4E14 CD4Q 3YEQ DJ67 5L6G YAM7 RNF4` | 50,000,000 NIM active **+ 25,000,000 inactive** | Payouts at 00:00 and 12:00 UTC. Shows the Unstaking card ("Ready now", inactive since block 54,043,200) |
| ObsidianStake | `NQ47 P7A4 FB6L FCG1 LGU9 B8UE AXV8 ADH8 5XVR` | 18,666,333 NIM | Also gets other txs |

Edge cases worth testing:
- `NQ51 KVXF RMYV 9HPD CA8N 5X10 7SUY 2C29 MU2T`: **not a staker**, but receives ObsidianStake payouts. Shows Home (not staked) with a 13,990 NIM balance, and the past kickbacks appear in the feed.
- `NQ04 9B94 6GPG 27P8 QN2G NJTY G1PX C5J3 NQ3K`: delegated to Nimiq.Fun but was paid by ObsidianStake, so it recently switched pools.
- `NQ15 C203 9Q4J URV1 RC2M NJL1 M2QF GDU7 4E6J`: staker in **NimiqPocket (restake)**. Shows the "Your pool restakes your rewards" notice.
- `NQ94 9K0H FB0L FV2F NAQH L49Q 5E34 JL41 6GVG`: receives Nimiq.Fun payouts as AddStake to the staking contract (`relatedAddresses` case).

## RPC calls on a cold open (empty cache)

Measured in the browser with localStorage cleared, previewing a Nimiq.Fun staker:

| Call | Count |
|---|---|
| `getStakerByAddress` | 1 |
| `getAccountByAddress` (preview only; inside Nimiq Pay the balance comes from the SDK) | 1 |
| `getTransactionsByAddress` (user, max 100, 30 days fitted in 1 page) | 1 |
| `getValidatorByAddress` (reward address of each pool shown) | 2 |
| `getTransactionsByAddress` (one probe per pool, max 25) | 2 |
| **Total** | **7 calls, 7 units** (6 inside Nimiq Pay) |

That's well under the 16-unit budget per 10 s (the node allows 20). Nothing was queued, and there were no 429s. Home was on screen about 1 s after opening.
A staker with inactive stake adds 2 (`getBlockAfterReportingWindow`, `getBlockNumber`).
A warm open (cache under the TTLs) used 3 calls. Background refreshes run every 2 min while the app is visible.
The worst case (every probe stale, so both pools are scanned) adds up to 2 × 5 units per page. The token bucket spreads that out instead of exceeding the limit.

The Validators API calls (direct list, status, supply) aren't counted against the RPC limit. They're cached for 6 h, 30 min and 6 h.
