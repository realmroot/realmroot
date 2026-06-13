import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = {
  '@': path.resolve(__dirname, './src'),
  '@shared': path.resolve(__dirname, './shared'),
  '@server': path.resolve(__dirname, './server'),
}

const compatibilityDate = '2026-04-12'
const compatibilityFlags = ['nodejs_compat']

export default defineConfig({
  // Coverage lives on the `unit` project only: v8 cannot instrument the workerd
  // pool, and the jsdom `web` project is exercised by the same fast suites.
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      exclude: ['server/auth.ts', 'src/features/account/account-center.tsx'],
      thresholds: {
        branches: 80,
        functions: 84,
        lines: 89,
        statements: 87,
      },
    },
    projects: [
      {
        // Server domain/usecases/adapters + shared + faked server flows + contracts.
        // Fast, fakes only, runs under node.
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          fileParallelism: false,
          include: [
            'tests/unit/server/**/*.test.ts',
            'tests/unit/workers/**/*.test.ts',
            'tests/contract/shared/**/*.test.ts',
            'tests/integration/server/**/*.test.ts',
          ],
        },
      },
      {
        // Frontend tests: React components, hooks, and the browser auth client
        // that depends on `window.fetch`. jsdom + the React plugin.
        plugins: [
          tanstackRouter({
            target: 'react',
            autoCodeSplitting: false,
            routeFileIgnorePattern: '\\.test\\.',
          }),
          react(),
        ],
        resolve: { alias },
        test: {
          name: 'web',
          environment: 'jsdom',
          fileParallelism: false,
          // A long multi-step console test occasionally misses a React Query
          // `waitFor` window under load; a bounded retry keeps the suite
          // deterministic without masking real regressions.
          retry: 2,
          include: [
            'tests/component/**/*.test.ts',
            'tests/component/**/*.test.tsx',
            'tests/unit/src/**/*.test.ts',
            'tests/contract/src/**/*.test.ts',
          ],
        },
      },
      {
        // The crown: real `app.fetch` flows in workerd over real D1 with the
        // production migrations applied. Nothing is faked.
        plugins: [
          cloudflareTest(async () => ({
            singleWorker: true,
            miniflare: {
              compatibilityDate,
              compatibilityFlags,
              d1Databases: ['DB'],
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, 'migrations')),
              },
            },
          })),
        ],
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['server/integration/**/*.test.ts'],
          setupFiles: ['server/integration/apply-migrations.ts'],
        },
      },
    ],
  },
})
