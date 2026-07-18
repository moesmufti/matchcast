import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    // Respect the harness-assigned PORT (autoPort) without needing @types/node.
    port: Number(
      (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PORT ??
        8791,
    ),
  },
})
