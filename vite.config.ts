import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const sdkVersion = JSON.parse(readFileSync(new URL('./node_modules/@nimiq/mini-app-sdk/package.json', import.meta.url), 'utf8')).version as string

function commit(): string {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return 'unknown' }
}

// Same as Nimcade and the Nimiq mini app docs: the dev server must be
// reachable from a phone on the same Wi-Fi so Nimiq Pay can load
// http://<mac-ip>:5173.
export default defineConfig({
  plugins: [vue()],
  // Relative asset paths, so the build works from any folder or host.
  base: './',
  define: {
    __SDK_VERSION__: JSON.stringify(sdkVersion),
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
    __APP_COMMIT__: JSON.stringify(commit()),
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
