# Testing Kickback inside Nimiq Pay

Production: https://kickback-ecru.vercel.app (Vercel project `kickback`, deploy with `npx vercel --prod`).

## Open it (from the official docs, nimiq.dev/mini-apps)

1. **Custom URL field (the documented dev route):** Nimiq Pay → **Mini Apps** → paste the URL into the **Custom URL** field.
2. **HTTPS deeplink:** `https://nimpay.app/miniapps/open/kickback-ecru.vercel.app`, tapped on the phone.
3. **Custom scheme:** `nimiqpay://miniapp?url=kickback-ecru.vercel.app`

For links 2 and 3, Nimiq Pay shows a warning first if the URL isn't in its mini app list or has never been opened.
The docs write the target without `https://`.

Local dev server instead: `npm run dev`, then put `http://<mac-ip>:5173` into the Custom URL field (same Wi-Fi).

Testnet: open the app menu and long-press the settings button for 10 seconds to get a dev menu with a network switch.
On testnet, the empty home screen has a "Get free NIM" button.

## Diagnostics

On the Home screen, tap the **K logo** 5 times within 3 seconds. The sheet shows the SDK version, whether the host
objects exist, detection and call timings, the raw `listAccounts` / `getBalance` results, staker and account info
from `rpc.nimiqwatch.com`, and every error with its name, type, code and message. "Run getBalance again" calls it a
second time. "Copy all" copies everything as text.

## Preview another address (read only)

Diagnostics → **Preview address** → paste an address → **Apply**. The whole app reads that address (balance from
RPC `getAccountByAddress`), a "Preview: NQ.. … (read only)" strip stays at the top, and every money action says
"Preview is read only". It survives restarts until you tap **Clear**. Test addresses are in `docs/data-notes.md`.

Dev only: `http://localhost:5173/?preview=NQ03J45B27LTQHD72PRM73QPSB15LM6HVCR8` reads an address with live data in a
desktop browser without Nimiq Pay. Production builds ignore it.
