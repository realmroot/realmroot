import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    tailwindcss(),
    react(),
    ...(mode === 'test' ? [] : [cloudflare({ configPath: process.env.CF_WRANGLER_CONFIG ?? 'wrangler.toml' })]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@server': path.resolve(__dirname, './server'),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        branches: 60,
        functions: 46,
        lines: 62,
        statements: 62,
      },
    },
    environment: 'jsdom',
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
}))
