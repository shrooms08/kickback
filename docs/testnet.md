# Testnet

Kickback runs on Nimiq PoS **testnet** when Nimiq Pay is on testnet, so every real transaction (stake, run my plan, stop, undo, withdraw, switch) can be tested with free test NIM. Mainnet behaviour and mainnet storage are unchanged.

Checked on 2026-10-21.

## How Kickback knows the network

- The SDK exposes `getHostNetwork()` (`@nimiq/mini-app-sdk` 0.2.4), which just reads `window.nimiqPay.network`: `'mainnet' | 'testnet'`, or `undefined` outside Nimiq Pay and on host versions older than the field.
- Nimiq Pay seeds it before the page script runs (`window.__NIMIQ_PAY__ = { lang, userFiat, network: isTestnet ? 'testnet' : 'mainnet' }` in `src/lib/mini-app-launcher.ts` of nimiq/nimiq-pay-app).
- **It cannot change while the app is open.** The SDK README says these values "are static for the lifetime of a Mini App session"; a change is picked up the next time the Mini App opens. Inside Nimiq Pay, switching network reloads the whole app (`router.go(0)`), which closes the Mini App.
- Kickback therefore decides once at startup (`src/lib/net.ts`):
  1. dev builds only: `?net=test` (wins, also over a faked host, for Playwright);
  2. the host network from the SDK;
  3. otherwise mainnet (browser, dev preview, older hosts).
- Diagnostics shows the network, where it came from, the RPC URL, the API URL and the explorer.

## Endpoints

| | Mainnet | Testnet |
|---|---|---|
| JSON-RPC | `https://rpc.nimiqwatch.com` | `https://rpc.testnet.nimiqwatch.com` |
| Validators API | `https://validators-api-main.je-cf9.workers.dev` | `https://validators-api-test.je-cf9.workers.dev` |
| Explorer | `https://nimiq.watch/#<hash>` | `https://test.nimiq.watch/#<hash>` |
| Network id | 24 | 5 |
| Genesis block | 3,456,000 | **3,032,010** |

**Testnet RPC.** Nimiq Pay itself uses `rpc.testnet.nimiqwatch.com` for testnet Mini Apps (`NIMIQ_RPC_URL` in the launcher). It allows browsers: the preflight answers `access-control-allow-origin: *`, `access-control-allow-methods: POST`, `access-control-allow-headers: content-type`, with the same `x-ratelimit-*` headers (20 units per window) as mainnet. Tested with `fetch` from a page on `http://localhost:5173` in Playwright Chromium (the server's own CORS headers passed through unchanged, so Chromium enforced them):

| Method | Result |
|---|---|
| `getBlockNumber` | 14,687,055 |
| `getAccountByAddress` | Puddle: basic, 6,473,743 NIM |
| `getStakerByAddress` | `NQ21 C3EU F69A E1GV UFVC XSSJ HLXB SJU5 DRAF`: 107.44 NIM active, delegated to Puddle |
| `getValidatorByAddress` | Puddle: balance, reward address (= its own address) |
| `getTransactionsByAddress` | 100 transactions |
| `getTransactionByHash` | `c31a…7240`: to type 3 (staking), recipientData `06` (AddStake) |

Also available on testnet: `getActiveValidators` (10 validators), `getPolicyConstants`, `getBlockByNumber`, `getBlockAfterReportingWindow`, `getBlockAfterJail`. `getStakersByValidatorAddress` is not allowed (same as mainnet).

`rpc-testnet.nimiqcloud.com` did not answer; `seed1.pos.nimiq-testnet.com:8648` returns 403.

**Testnet Validators API.** Listed in the nimiq/validators-api README ("Testnet" link, deployment section). Same endpoints, `access-control-allow-origin: *`. `/api/v1/validators` lists 13 validators.

**Genesis matters.** Election blocks are counted from the genesis block. With the mainnet genesis on testnet, "the last election" would be block 14,644,800, which is a micro block; the real one (14,652,810) is a macro block. `GENESIS_BLOCK` now comes from the network config.

## Pools on testnet

| Validator | API payout type | Notes |
|---|---|---|
| Puddle (`NQ82 BHPS …`) | direct | Pays **into stake**: every payout is an AddStake (`06`) from its reward address to the staking contract for the staker. Kickback sees these as restaked kickbacks (counted in Earned, not in Ready to share). |
| ObsidianStake (`NQ15 5JNS …`) | direct | Not active on chain; no outgoing payouts since July. |
| Siam Testnet Pool, Monopooly, Not-A-Pool, Kiddie Pool, Cool Pool, Swimming Pool, Pool Billard, Helvetia, Pooly McPoolface, Mint Pool, NimiqHub | restake | |
| `NQ30 59XY … RTSL`, `NQ42 FN9R … VGKV` | (not listed) | Active on chain only. |

Every testnet validator's reward address is the validator address itself.

So **no testnet pool pays kickbacks to the wallet.** Kickback on testnet:

- lists every active validator (RPC `getActiveValidators`), named from the testnet API when listed, otherwise a short address; same cards, same sort (cheapest first, unlisted last with fee "Unknown"), each labelled **Testnet validator**;
- skips the payout check and the 72-hour filter (reward addresses are flooded with block rewards, a scan would cost up to 50 RPC units per validator);
- keeps kickback detection unchanged (incoming from a pool's reward address, or an AddStake naming the user).

## Test kickback (testnet only)

Diagnostics → **Testnet: test kickback** → amount (default 1 NIM) → **Mark test kickback**.

- It marks real testnet NIM already in the wallet as ready to share. It may not exceed the wallet balance (read fresh from Nimiq Pay) minus the 0.01 NIM fee reserve minus what is already ready.
- Dry run must be off. It is stored in the testnet plan (`kb:t:plan:<address>`), so it never exists on mainnet, and the control is not rendered on mainnet.
- Like a dry-run kickback it counts as soon as a plan exists. Before a plan is saved the toast says so.
- Run my plan then sends real testnet transactions: the send with memo, the restake (AddStake), and keep (no transaction), with the normal approvals, confirmation polling, partial states and Retry.

## Storage

All storage goes through `src/lib/cache.ts`. On testnet every key gets a `t:` namespace: `kb:t:plan:…`, `kb:t:ops:…`, `kb:t:run:…`, `kb:t:moneylog`, `kb:t:c:snap:…` and so on. Mainnet keys are unchanged (`kb:plan:…`), so existing mainnet data stays where it was and the two never mix: plans, contacts, the shared-amounts ledger, test kickbacks, op history, caches and the dry-run state are all per network.

## Money action log

Diagnostics → **Money log** keeps the newest 30 real sends (never dry run) per network: network, flow and SDK call, amount, recipient or delegation, the hash Nimiq Pay returned, the explorer link, how long after sending it confirmed, and the transaction **as read back** with `getTransactionByHash`: account types, `recipientData[0]`, `senderData[0]`, flags, value, execution result, next to what was expected:

| SDK call | Expected on chain |
|---|---|
| `sendBasicTransactionWithData` | basic → basic, data = memo |
| `sendNewStakerTransaction` | basic → staking, recipientData `05` CreateStaker |
| `sendStakeTransaction` | basic → staking, recipientData `06` AddStake (confirmed on mainnet before) |
| `sendUpdateStakerTransaction` | basic → staking, recipientData `07` UpdateStaker |
| `sendSetActiveStakeTransaction` | basic → staking, recipientData `08` SetActiveStake |
| `sendRetireStakeTransaction` | basic → staking, recipientData `09` RetireStake |
| `sendRemoveStakeTransaction` | staking → basic, senderData `01` RemoveStake |

"Copy all" in Diagnostics copies the whole log.

## Faucet

- **Inside Nimiq Pay (testnet):** an empty testnet account shows "Your testnet account is empty." and a **Get free NIM** button on the home screen's transaction list (`TestnetFaucet.vue`). It only shows while the account has no transactions and a 0 balance.
- **API:** `POST https://faucet.pos.nimiq-testnet.com/tapit` with the address, either form-encoded (`address=NQ…`, optional `amount`, per the developer docs) or JSON `{ "address": "NQ…" }` (what Nimiq Pay sends). Errors: `RATE_LIMIT` (with `wait` seconds), `GEOBLOCKED`, `OUT_OF_FUNDS`, `TRANSACTION_FAILED`.
- `GET /info` on 2026-10-21: `dispenseAmount` 110,000 (the faucet balance divided by it gives the "dispenses remaining", so it is NIM), 7,740 dispenses left. The developer docs say up to 10,000 NIM per request. Either is far more than a test needs.
- A Nimiq address is the same on every network, so your Nimiq Pay address is also your testnet address.

## Switching Nimiq Pay to testnet

From the Nimiq Pay source (nimiq/nimiq-pay-app: `MenuModal.vue`, `DevModal.vue`, `lib/network.ts`); not verified on a store build:

1. Open the menu, then **press and hold "Settings" for 3 seconds**. The Dev panel opens.
2. Under **Network**, pick **Testnet**, then **Switch**. Nimiq Pay clears its local transaction history, remote signer registrations and pending swaps (wallet, PIN and backup stay), stores the choice and reloads.
3. An orange **TESTNET** pill shows at the top while the override is on. To go back, pick **Default** or **Mainnet** the same way.

## Waits on testnet

A testnet epoch is 43,200 blocks like mainnet; blocks run slightly faster (measured 42,543,068 ms per epoch = **11.82 h**; the Validators API reports 11.8 h).

| Step | Wait |
|---|---|
| Any transaction | confirms in a few seconds (1 s blocks); "slow" after 2 min |
| Stake starts earning | next election: 0 to 11.8 h |
| First Puddle payout (into stake) | after one full epoch with the stake: about 12 to 24 h |
| Stop earning → withdrawable | next election + one epoch + 1 block: 11.8 to 23.6 h (`getBlockAfterReportingWindow`) |
| Undo (keep earning) | immediate, while the stake is still inactive (not retired) |
| Switch pool | needs the stake released and nothing active; takes effect at the next election |
