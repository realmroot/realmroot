import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

const alias = {
  '@': path.resolve(__dirname, './src'),
  '@shared': path.resolve(__dirname, './shared'),
  '@server': path.resolve(__dirname, './server'),
}

const compatibilityDate = '2026-04-12'
const compatibilityFlags = ['nodejs_compat']

export default defineConfig({
  // Coverage gates only the layers the fast (v8-instrumentable) `unit` + `web`
  // suites own. The workerd `integration` crown can't be v8-instrumented, so the
  // edge layers it proves (adapters/repos, composition, worker, http full-flow,
  // the real JWKS verify path) are excluded — counting them here is a false 0%.
  test: {
    coverage: {
      provider: 'v8',
      // text hides fully-covered files; json-summary exposes the real per-file data.
      reporter: ['text', 'json-summary', 'lcov'],
      // Allowlist: business logic + testable frontend + stub-fetch gateways.
      include: [
        'server/domain/**',
        'server/usecases/**',
        'server/adapters/gateways/**',
        'shared/api/**',
        'src/features/**',
        'src/lib/**',
      ],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.test-utils.{ts,tsx}', // co-located test helpers
        '**/*.test-fixtures.{ts,tsx}',
        '**/*fixtures*.{ts,tsx}',
        '**/*.d.ts',
        '**/index.ts', // barrels
        'server/adapters/gateways/jwks.ts', // real JWKS fetch/verify — crown-proven
        // presentational / config / generated glue
        'src/lib/theme.tsx',
        'src/lib/utils.ts',
        'src/lib/auth-client.ts', // thin better-auth client wiring
        'src/lib/i18n*.ts',
        'src/features/**/*.gen.ts',
      ],
      thresholds: {
        perFile: true,
        // business logic is exhaustively unit-tested with fake ports
        'server/domain/**': { branches: 95, functions: 95, lines: 95, statements: 95 },
        'server/usecases/**': { branches: 95, functions: 95, lines: 95, statements: 95 },
        // everything else in the allowlist
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
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
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'server/integration/**'],
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
          include: ['src/**/*.test.{ts,tsx}'],
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
