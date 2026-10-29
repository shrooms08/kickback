# Nimiq Pay Mini App SDK notes

Package: `@nimiq/mini-app-sdk` **0.2.4** (installed with `npm install @nimiq/mini-app-sdk`, same as Nimcade).
Source of truth: `node_modules/@nimiq/mini-app-sdk/dist/index.d.ts` and `dist/provider.d.ts`, plus the runtime in `dist/index.js`.

Nimcade used **0.1.0**. The API is the same, but how errors are reported changed in 0.2.x. See "Errors" below.

## Getting the provider

```ts
import { init, NimiqProviderError } from '@nimiq/mini-app-sdk'

const nimiq = await init({ timeout: 3000 }) // InitOptions { timeout?: number }, default 10_000 ms
```

- `init()` resolves straight away if `window.nimiq` is already injected. Otherwise it polls every 50 ms.
  After `timeout` it rejects with `Error("Nimiq provider was not injected. Are you running inside a Nimiq app?")`.
- Nimcade treated that rejection as "not inside Nimiq Pay" and showed its "open in Nimiq Pay" state. Kickback does the same.
- `window.nimiqPay` (`NimiqPayHostContext`: `language`, `userFiat`, `network`, fullscreen helpers, `requestDeviceIdentifier`)
  is "seeded synchronously before the Mini App's page script runs". Kickback checks it first as a fast path,
  then falls back to `init()` with a timeout.
- Repeated `init()` calls return the same wrapper.

## Errors (changed since Nimcade)

The provider returned by `init()` is a Proxy around `window.nimiq`. Its wallet methods **resolve with the
success value and reject with `NimiqProviderError`**. They never resolve with `{ error }` any more.
(Nimcade's `unwrap()` for `{ error }` results isn't needed now, but it does no harm.)

```ts
class NimiqProviderError extends Error {
  readonly type: string   // e.g. 'PERMISSION_DENIED'
  readonly code?: number  // original RPC code
  readonly data?: unknown
  static is(error: unknown): error is NimiqProviderError // works across bundles
}
```

How the SDK maps codes to types: `4001 → PERMISSION_DENIED` (user rejected), `4200 → UNKNOWN_REQUEST`,
`-32602 → INVALID_TRANSACTION`, `-32000 → NETWORK_ERROR`, `-32603 → INTERNAL_ERROR`. Unknown codes become `UNKNOWN_ERROR`.

**User rejected** = `NimiqProviderError.is(e) && e.type === 'PERMISSION_DENIED'` (or `e.code === 4001`).

## Wallet methods (all ask the user to confirm, except getBalance)

Amounts are in **Luna**: 1 NIM = 100,000 Luna.

| Method | Params | Resolves |
|---|---|---|
| `listAccounts()` | none | `string[]` (user-friendly addresses, `NQ.. .... ...`) |
| `getBalance(address)` | `address: string` | `number` (Luna, from the host's active network) |
| `sendBasicTransaction(tx)` | `{ recipient: string; value: number; fee?: number; validityStartHeight?: number }` | `string` (tx hash / serialized tx) |
| `sendBasicTransactionWithData(tx)` | `{ recipient: string; value: number; data: string; fee?: number; validityStartHeight?: number }` | `string` |
| `sendNewStakerTransaction(tx)` | `{ delegation: string; value: number; fee?: number; validityStartHeight?: number }` | `string` |
| `sendStakeTransaction(tx)` | `{ value: number; fee?: number; validityStartHeight?: number }` | `string` |

All six exist and are confirmed in the installed types. The wrapper also exposes `sign`, `payLightningInvoice`,
`sendSetActiveStakeTransaction({ newActiveBalance })`, `sendUpdateStakerTransaction({ newDelegation, reactivateAllStake? })`,
`sendRetireStakeTransaction({ retireStake })` and `sendRemoveStakeTransaction({ value })`.

Non-wallet methods (no confirmation, and not wrapped, so they keep the old behaviour):
`isConsensusEstablished(): Promise<boolean>`, `getBlockNumber(): Promise<number>`, `setRPCUrl(url)`, `getRPC()`, `setRPC(rpc)`.

## Other exports

`getHostLanguage()`, `getHostFiat()` (`Fiat`: USD, EUR, CRC, GMD), `getHostNetwork()` (`'mainnet' | 'testnet'`),
`requestDeviceIdentifier({ reason })`, `requestFullscreen()`, `exitFullscreen()`, `getFullscreen()`, `onFullscreenChange(fn)`.

## Dev server

Same as Nimcade and the Nimiq docs: `server: { host: true, port: 5173 }` in `vite.config.ts`, so Nimiq Pay on a phone on the same Wi-Fi can load `http://<mac-ip>:5173`.

## Things not confirmed yet

- `getBalance` wasn't in the Nimiq docs' method list that Nimcade worked from. It is in the 0.2.4 types and in the
  wrapper's wallet-method set, so the SDK treats it like a wallet call. Whether Nimiq Pay shows a confirmation for it
  still needs testing on a real device.
- `sendBasicTransaction` is documented as returning the "transaction hash", but the JSDoc says "the serialized transaction".
  Treat the string as opaque until phase 3 checks it on-chain.
- Whether `getBalance` returns the total or only the spendable balance for an address that also has stake.

## Phase 3: sending (confirmed against the installed 0.2.4 types and the nimiq.dev provider reference)

| Method | Params (all `fee?`, `validityStartHeight?` optional) | Returns |
|---|---|---|
| `sendBasicTransaction` | `{ recipient, value }` | `string` tx hash |
| `sendBasicTransactionWithData` | `{ recipient, value, data }`, where `data` is a **plain text string** that's public on chain. Kickback sends `"Kickback"`. | `string` |
| `sendNewStakerTransaction` | `{ delegation, value }` | `string` |
| `sendStakeTransaction` | `{ value }` | `string` |
| `sendSetActiveStakeTransaction` | `{ newActiveBalance }` | `string` |
| `sendUpdateStakerTransaction` | `{ newDelegation, reactivateAllStake? }` | `string` |
| `sendRetireStakeTransaction` | `{ retireStake }` | `string` |
| `sendRemoveStakeTransaction` | `{ value }` | `string` |

- Every call shows its own Nimiq Pay confirmation.
- The docs say "A returned hash identifies the transaction; it does not prove successful execution or finality."
- Nimiq Pay chooses the sender. There's no address parameter.

**Default fee:** "Nimiq Pay chooses a fee automatically, using 0 if possible." Kickback never passes `fee`, and keeps 0.01 NIM in reserve.

### Error types (`NimiqProviderError.type`, with the fallback RPC code)

| Type | Code | Kickback treats it as |
|---|---|---|
| `PERMISSION_DENIED` | 4001 | **Cancelled.** "You cancelled. Nothing was sent." Also `USER_REJECTED`, `USER_CANCELLED` / `USER_CANCELED`, `CANCELLED` / `CANCELED`, `REJECTED`, `ACTION_REJECTED` (names other hosts use for the same thing). |
| `TRANSACTION_OUTCOME_UNKNOWN` | | Unknown: search the chain. Never a cancel. |
| `UNKNOWN_REQUEST` | 4200 | Not sent: the host doesn't support the request. |
| `INVALID_TRANSACTION` | -32602 | Not sent: bad parameters. |
| `NETWORK_ERROR` | -32000 | If the message says "Nimiq network is not ready", the host is still syncing, so it **retries 5 times** (1, 2, 3, 4, 5 s) before sending anything. Otherwise **unknown**: search the chain. |
| `INTERNAL_ERROR` | -32603 | Unknown: search the chain. |
| `UNKNOWN_ERROR` (or any other type) | any | Unknown: search the chain. |

**After an unknown error:** the op stays "Still checking if it went through" for **10 minutes** (elapsed time shown, nothing can be sent again meanwhile): the newest 25 transactions of the address every 5 s for the first minute, then every 20 s. Then a deep search decides: the address history paged to at least 200 transactions and 2 hours back (at most 500), plus `mempoolContent(true)`. Matching is by sender, recipient, value, payment data (`Kickback`) and the staking data type byte (`05` CreateStaker, `06` AddStake, `07` UpdateStaker, `08` SetActiveStake, `09` RetireStake). Hashes already in the share ledger never match. The result is "sent, confirming", "Failed. Nothing was sent." (a JSON-RPC node answered both reads), or it keeps checking (only REST, the proxy, or nothing answered).

**Confirming:** poll RPC `getTransactionByHash(hash)` every 4 s.
- `-32603 "Transaction not found: …"` means not yet.
- `blockNumber > 0` means included, and `executionResult: false` means it failed on chain.
- After 2 minutes the app shows "Still confirming" and keeps polling in the background.

**Never twice:**
- Each send is an op persisted per address in localStorage. Reopening the app resumes checking (a chain search or inclusion polling) and never re-sends.
- Run my plan and Withdraw steps are persisted too, dry-run and real runs under separate keys. A run that can't continue ends as partial, with Retry for only the unsent amounts. A step whose op was pruned is "Not sure it went through".
- A run step's share is recorded by the ops store when its op confirms, with the op id (a uuid) as the ledger and server share id, so a resumed op is counted exactly once.
- Retry first searches the chain deeply for every step that may have gone out (uncertain error or pruned op), follows a found transaction instead of paying again, and sends nothing within 10 minutes of the error or while the chain can't be read. It refuses a run of the other mode (dry run vs real).
- One money action starts at a time: a lock is taken before the first await (balance read), so a second hold does nothing. Dry run, preview and Choose wallet can't change while anything is starting, running or confirming.
- Right before every send: the recipient must be a valid Nimiq address (checksum) and not your own, a delegation a valid validator address. When a sent transaction is included, its sender must be the connected address (for remove stake: its recipient); otherwise Kickback stops sending and says so.

### `getBalance` on the phone
- The first call 272 ms after boot failed with `NETWORK_ERROR -32000 "Nimiq network is not ready"`.
- The fix: `getBalance` retries on that error, the cached balance shows at once, and RPC `getAccountByAddress` fills in while the SDK retries.
- Home never shows a fake 0. An error shows only if the SDK and the RPC both fail.
