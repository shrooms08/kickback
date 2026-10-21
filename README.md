# Kickback

A Nimiq Pay mini app (Nimiq Mini Apps Competition, cycle 3, EARN). Stake NIM once with a direct-payout pool
(Nimiq.Fun or ObsidianStake); the pool pays a kickback about every 12 hours, and Kickback splits each one with
your plan: send to someone, restake, keep. Staked NIM is never touched by the app.

**Phase 2:** live mainnet data, read only. Pools from the Validators API, stake, kickbacks and payout rhythm from
`rpc.nimiqwatch.com` (rate limited, cached), the wallet balance from the SDK. Money buttons still show "Coming in
phase 3". See `docs/data-notes.md`.

## Run

```bash
npm install
npm run dev        # Vite with --host, port 5173
npm run build      # vue-tsc type check + production build
npm run preview
```

- Inside Nimiq Pay: open `http://<your-mac-ip>:5173` from Nimiq Pay on a phone on the same Wi-Fi.
- Desktop browser: `http://localhost:5173/?mock=1` uses a fake wallet and mock data, with a dev panel to reach every
  screen and edge state. `http://localhost:5173/?preview=NQ..` shows live data for any address (read only).
  Both only work in `npm run dev`; production builds ignore them.

## Layout

- `src/design`: tokens (Split complementary palette, motion, feedback), global CSS, the hatch tile (`npm run hatch` regenerates it from the fixed seed), Archivo font
- `src/components`: Stage (layered screen transitions), TheStack, SegmentedBar, HatchFill, HoldButton, Toast, Banner, BottomSheet, Modal, KLogo, PoolCard, ContactBubble…
- `src/screens`: one file per screen, `sheets/` for bottom sheets
- `src/stores`: Pinia (wallet, account, data, live, plan, flow, ui, nav, diag)
- `src/services`: `nimiq.ts` (SDK wrapper), `rpc.ts` (rate-limited JSON-RPC client), `validators.ts` (Validators API), `chain.ts` (stake, kickbacks, payout rhythm), `mock.ts` (fake data)
- `src/lib`: number formatting, Stack maths, animation helpers
- `docs/sdk-notes.md`: the real `@nimiq/mini-app-sdk` 0.2.4 signatures
- `design/Kickback Prototype.html`: the design source of truth
