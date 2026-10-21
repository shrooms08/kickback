# Kickback

A Nimiq Pay mini app (Nimiq Mini Apps Competition, cycle 3, EARN). Stake NIM once with a direct-payout pool
(Nimiq.Fun or ObsidianStake); the pool pays a kickback about every 12 hours, and Kickback splits each one with
your plan: send to someone, restake, keep. Staked NIM is never touched by the app.

**Phase 1 (this commit):** design system, app shell with every screen on mock data, real wallet connection.
Staking, payout detection and Supabase come later. Money buttons show "Coming in phase 3".

## Run

```bash
npm install
npm run dev        # Vite with --host, port 5173
npm run build      # vue-tsc type check + production build
npm run preview
```

- Inside Nimiq Pay: open `http://<your-mac-ip>:5173` from Nimiq Pay on a phone on the same Wi-Fi.
- Desktop browser: `http://localhost:5173/?mock=1` uses a fake wallet and shows a dev panel to reach every
  screen and edge state. `?mock=1` only works in `npm run dev`; production builds ignore it.

## Layout

- `src/design`: tokens (Split complementary palette, motion, feedback), global CSS, the hatch tile (`npm run hatch` regenerates it from the fixed seed), Archivo font
- `src/components`: Stage (layered screen transitions), TheStack, SegmentedBar, HatchFill, HoldButton, Toast, Banner, BottomSheet, Modal, KLogo, PoolCard, ContactBubble…
- `src/screens`: one file per screen, `sheets/` for bottom sheets
- `src/stores`: Pinia (wallet, account, plan, flow, ui, nav)
- `src/services`: `nimiq.ts` (SDK wrapper), `mock.ts` (fake data)
- `src/lib`: number formatting, Stack maths, animation helpers
- `docs/sdk-notes.md`: the real `@nimiq/mini-app-sdk` 0.2.4 signatures
- `design/Kickback Prototype.html`: the design source of truth
