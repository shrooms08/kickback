# Spike: "Save as USDT" plan slice

Read-only feasibility check, 2026-10-23. No app code changed, nothing sent, no swap created. Quotes and estimates only.

**Verdict: DROP.** A kickback slice is far too small to swap. One NIM is about 0.40 sats ($0.00033), the swap service's minimum is 356 sats (about 889 NIM), and keeping the total cost under 3% needs about 125,000 NIM in one swap. With a 10% slice that takes a 10,000 NIM staker about 1,700 years to collect. Details and evidence below.

## The idea

Nimiq's Cycle 3 ideas ("NIM exit hub", "Rewards to stablecoins"): the Mini App creates a LendaSwap Lightning-to-EVM swap (USDT on Polygon to the user's own address), pays its Lightning invoice with the provider's `payLightningInvoice` in NIM, then claims the USDT gaslessly. The swap is atomic: if it fails, the Lightning payment fails back.

## 1. `payLightningInvoice` in @nimiq/mini-app-sdk 0.2.4

**Yes, it is there, and 0.2.4 is the newest release** (npm: 0.2.4 published 2026-09-29; no later version). No upgrade is needed.

```ts
// dist/provider.d.ts
/** Submit a self-custodial NIM or USDT to BTC Lightning payment. Success means the payment transaction was submitted. */
payLightningInvoice(request: { invoice: string }): Promise<LightningPaymentResult | ErrorResponse>
interface LightningPaymentResult { hash: string, swapId: string }
// dist/index.d.ts (wrapped provider from init())
payLightningInvoice(...): Promise<LightningPaymentResult>   // throws NimiqProviderError
```

README: the host asks the user to allow invoice lookup, choose **NIM or USDT**, and approve a self-custodial swap to BTC Lightning. Success means the payment transaction was submitted; Lightning settlement may still be pending. Fixed-amount BOLT11 invoices and LNURLs only. **"The invoice must match the host network."** A reused invoice rejects with `DUPLICATE_PAYMENT`, an uncertain one with `TRANSACTION_OUTCOME_UNKNOWN` ("do not retry").

Host side (nimiq/nimiq-pay-app `src/composables/useMiniAppHost.ts` `payLightningInvoice`):

- Two prompts: a one-time "Lightning access" consent per wallet and network, then a payment confirmation showing the BTC amount, the NIM (or USDT) amount and the swap fees.
- The NIM side is a **Fastspot atomic swap** (NIM HTLC to BTC Lightning, `useFastspotApiV2().createSwap(... { asset: BTC_LN, peer: <invoice> })`). It checks the swap quote's expiry, balance, and Fastspot's current limit (rejects above 99% of it).
- Not mainnet-only in code: it uses Fastspot's test environment on testnet (`api.test.fastspot.io`), so it needs a testnet Lightning invoice there.
- Lightning is behind a build flag: `__ENABLE_BTC_LN__: true, // Enable BTC LN by default, remove this once Apple is not complaining` (vite.config.ts). It could be switched off on iOS later.

## 2. The user's own Polygon address

Nimiq Pay injects an **EIP-1193 `window.ethereum`** (also announced via EIP-6963) next to `window.nimiq` (docs/ARCHITECTURE.md). `eth_requestAccounts` (or `wallet_requestPermissions` for `eth_accounts`) shows an **"accounts" approval** (`requestUserConfirmation({ type: 'accounts', network: 'ethereum' })`). The approval is cached for the session; `eth_accounts` returns it without a new prompt. The address is the same wallet's EVM key (`m/44'/60'/0'/0/0`), the one that holds Nimiq Pay's own USDT on Polygon. So: **yes, one extra approval** (per session), and no chain switch is needed just to read it.

## 3. LendaSwap (now Satora): quotes, limits, fees

**The package named in the guide is stale.** `@lendasat/lendaswap-sdk` 0.1.77 (last published March 2026) defaults to `https://apilendaswap.lendasat.com`, which now returns **Cloudflare 525**, and its quote call no longer matches the API (`missing field source_chain`). The maintained SDKs are **`@lendasat/lendaswap-sdk-pure` 2.6.1** ("legacy SDK, keeps working") and **`@satora/swap`** (drop-in, same API, where new features land), both pointing at **`https://api.satora.io`**. I used `lendaswap-sdk-pure` 2.6.1 with in-memory storage in `/tmp/lendaswap-spike` (not in the repo).

`client.getQuote({ sourceChain: 'Lightning', sourceToken: 'btc', targetChain: '137', targetToken: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' /* USDT0 on Polygon */, sourceAmount })`. The USD amounts below use 6 decimals.

| Input | Sats | Result (net USDT) | Notes |
|---|---|---|---|
| 1 NIM | 0.40 → 1 | 0 | below minimum |
| 5 NIM | 2 | 0 | below minimum |
| 10 NIM | 4 | 0 | below minimum |
| 25 NIM | 10 | 0.0044 | below minimum (quote only) |
| 100 NIM | 40 | 0.0286 | below minimum (quote only) |
| ~2,500 NIM | 1,000 | 0.8059 | fee 5 + 4 sats |
| ~25,000 NIM | 10,000 | 8.0914 | fee 50 + 4 sats |
| ~125,000 NIM | 50,000 | ~40.5 | interpolated, not queried |
| ~250,000 NIM | 100,000 | 80.9027 | fee 500 + 4 sats |

Every quote returned the same terms:

- **Minimum 356 sats, maximum 20,000,000 sats** (`min_amount`, `max_amount`).
- **Protocol fee 0.5%** (`protocol_fee_rate: 0.005`) **plus a 4-sat network fee**; `gasless_network_fee: 0`.
- Exchange rate about 81,320 USD per BTC against 81,444 market (CoinGecko), so about **0.15%** below mid.
- At the minimum (356 sats, $0.29) that is 1.8% in total; at 10,000 sats 0.7%; at 100,000 sats 0.65%.

**Swap mechanics** (from `https://api.satora.io/api-docs/openapi.json`, `POST /swap/lightning/evm`):

1. The user pays a **hold invoice**; the payment is held, not settled.
2. The server funds an ERC-20 HTLC on Polygon locked to the same hash.
3. The client claims (gasless), revealing the preimage.
4. The server settles the held payment.

If the server never funds, or the user never claims, the held payment returns when the hold expires. **The client generates and keeps the secret** (`hash_lock` is the sha256 of it). The SDK stores it in IndexedDB (Dexie, `lendaswap-v3`) before the invoice is paid. The response carries `invoice_expires_at` and `evm_refund_locktime`. I did not create a swap, so I have no real values for these.

**Claim really is gasless for the user.** `POST /swap/{id}/claim-gasless`: the server submits `coordinator.redeemAndExecute` with the client's EIP-712 signature and secret. The signing key is the SDK's own derived key (`claiming_address`), not the user's wallet. Any gas cost is deducted from the swap as `gasless_fee_sats` (currently 0). The app must be open (or reopened before the hold expires) to claim.

**Browser and API key:** CORS is open (`access-control-allow-origin: *`, any method and header on preflight). No API key: the OpenAPI spec has no security schemes, and quotes and `/tokens` worked without one.

## 4. Full cost path

**NIM → Lightning (Nimiq Pay via Fastspot):** Fastspot's public estimate endpoint quotes NIM → BTC without a key, but a Lightning estimate needs the payment's peer, which in practice means a real invoice (Nimiq Pay creates a Fastspot swap with the invoice to get the exact Lightning fee). I did not create one. From NIM → BTC estimates, with the on-chain fees removed:

| Size | NIM per 1 sat (Fastspot) | vs market mid |
|---|---|---|
| 10,000 sats | 2.566 | 2.7% worse |
| 50,000 sats | 2.552 | 2.1% worse |
| 200,000 sats | 2.579 | 3.2% worse |

This includes Fastspot's **0.25% service fee** (`serviceFeePercentage: 0.0025`); the rest is Fastspot's NIM price versus the market. NIM network fees are 0. Lightning routing adds a few sats. **These Lightning figures are estimates (±1%).**

**Total** (NIM → Lightning estimate + Satora quote):

| Amount | NIM → Lightning | Satora | Total |
|---|---|---|---|
| 1 / 5 / 10 / 25 / 100 NIM | n/a | below the 356-sat minimum | **not possible** |
| 889 NIM (356 sats, $0.29) | ~2.9% | 1.8% | **~4.7%** |
| 2,500 NIM (1,000 sats, $0.82) | ~2.8% | 1.05% | **~3.8%** |
| 25,000 NIM (10,000 sats, $8) | ~2.7% | 0.7% | **~3.4%** |
| 125,000 NIM (50,000 sats, $41) | ~2.1% | 0.65% | **~2.8%** |
| 500,000 NIM (200,000 sats, $163) | ~3.2% | 0.65% | **~3.8%** |

Fastspot's NIM pricing gets worse for large sizes (thin NIM liquidity), so under 3% only shows up around 50,000 sats, and even that isn't reliable.

## 5. Testnet

- **Nimiq Pay:** on testnet, `payLightningInvoice` goes through Fastspot's test environment and needs a testnet Lightning invoice ("must match the host network").
- **Satora/LendaSwap:** the only server in the API spec is `https://api.satora.io` (mainnet). The SDK has signet/regtest settings (for self-hosting), but I found no public test endpoint.

**The full path can only be tested with real NIM on mainnet.** Fastspot test plus a Satora mainnet invoice won't work: the networks don't match.

## 6. Thresholds and accumulation time

- **Minimum to swap at all:** 356 sats ≈ **889 NIM** (~$0.29), at ~4.7% total cost.
- **Minimum to keep total cost under 3%:** about **125,000 NIM** (~50,000 sats, ~$41), estimated, not guaranteed.

A 10% slice with two kickbacks a day:

| Stake | Kickback | 10% slice | Per day | To 889 NIM | To 125,000 NIM |
|---|---|---|---|---|---|
| 100 NIM | 0.01 NIM | 0.001 NIM | 0.002 NIM | ~1,218 years | ~171,000 years |
| 10,000 NIM | 1 NIM | 0.1 NIM | 0.2 NIM | ~12 years | ~1,712 years |

Reaching even the 889 NIM minimum within a month at 10% would need a stake of about 1.35 million NIM; the under-3% threshold would need about 190 million NIM.

## Other risks found

- **Hold invoice through a Fastspot swap is unproven.** The Lightning leg is itself an atomic swap: Nimiq Pay locks NIM in an HTLC and Fastspot pays the invoice. A hold invoice keeps the payment pending until the Mini App claims on Polygon, so Fastspot's NIM HTLC timeout must outlast the hold. Testing that needs real NIM.
- The app must stay open (or be reopened before the hold expires) to claim. Otherwise the payment returns, and the user paid nothing but saw a pending swap.
- Three approvals per swap: Lightning access (once), the `eth_requestAccounts` accounts prompt (once per session), and the payment.
- Lightning in Nimiq Pay sits behind a build flag with an App Store note.

## Verdict

**DROP.** It isn't the integration that kills it, it's the numbers: at about 0.4 sats per NIM, kickback slices are thousands of times below the 356-sat swap minimum, and a cost under 3% needs about 125,000 NIM per swap. That's years to millennia of collecting for realistic stakes. The flow itself looks buildable (SDK support exists, CORS is open, no key, the claim is gasless), but it can't be tested without real NIM.

If NIM's price rises about 100×, or Satora lowers its minimum by a similar factor, revisit it. Then the right shape is a separate "Cash out to USDT" action for an amount the user picks (at least ~889 NIM, shown with its fee), not a per-kickback slice. Rough effort for that: 25–35 hours (SDK and secret storage, eth_requestAccounts, swap state machine with resume and claim, fee preview, failure states, plus mainnet testing with real NIM).

## Sources

- `node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts`, `index.d.ts`, README "Bitcoin Lightning payments"; `npm view @nimiq/mini-app-sdk versions`.
- nimiq/nimiq-pay-app: `src/composables/useMiniAppHost.ts` (`payLightningInvoice`, `listEthAccounts`), `useFastspotV2.ts` / `useFastspotv1.ts`, `useStringParser.ts`, `docs/ARCHITECTURE.md`, `vite.config.ts`.
- `@lendasat/lendaswap-sdk` 0.1.77 and `@lendasat/lendaswap-sdk-pure` 2.6.1 (README, types); live `GET https://api.satora.io/quote` via the SDK; `https://api.satora.io/api-docs/openapi.json`; `https://api.lendaswap.com/tokens`; CORS preflight.
- Fastspot `GET /fast/v1/assets` and `POST /fast/v1/estimates` (keyless, NIM → BTC).
- Prices: CoinGecko (NIM $0.00032647, 4.004e-9 BTC; BTC $81,444) and CoinPaprika (NIM $0.0003264), 2026-10-23.
