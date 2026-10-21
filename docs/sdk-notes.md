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
