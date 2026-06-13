import { applyD1Migrations, env } from 'cloudflare:test'

// Apply the production D1 migrations (read in the Vite config via
// `readD1Migrations` and bound as `TEST_MIGRATIONS`) to the in-memory D1 the
// pool gives each worker. Runs once per worker before any test file imports.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
