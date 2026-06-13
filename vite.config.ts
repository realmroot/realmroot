import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: mode !== 'test',
      routeFileIgnorePattern: '\\.test\\.',
    }),
    tailwindcss(),
    react(),
    ...(mode === 'test'
      ? []
      : [
          cloudflare({
            configPath: process.env.CF_WRANGLER_CONFIG ?? 'wrangler.toml',
            persistState: process.env.CF_PERSIST_STATE_PATH ? { path: process.env.CF_PERSIST_STATE_PATH } : true,
          }),
        ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    port: 4179,
  },
}))
