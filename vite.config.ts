import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Same as Nimcade and the Nimiq mini app docs: the dev server must be
// reachable from a phone on the same Wi-Fi so Nimiq Pay can load
// http://<mac-ip>:5173.
export default defineConfig({
  plugins: [vue()],
  // Relative asset paths, so the build works from any folder or host.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
})
