import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  // Legacy hand-written migrations use the numeric NNNN_ prefix and remain the
  // applied production history. Generated migrations use a timestamp prefix so
  // they sort strictly after them and never collide. drizzle's snapshot in
  // migrations/meta is baselined to schema.ts; it is the single source of truth
  // going forward (run `pnpm db:generate`).
  migrations: {
    prefix: 'timestamp',
  },
  dbCredentials: {
    url: 'file:local.db',
  },
})
