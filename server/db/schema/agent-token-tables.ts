import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentDpopJti = sqliteTable(
  'agent_dpop_jti',
  {
    jtiHash: text('jti_hash').primaryKey(),
    keyThumbprint: text('key_thumbprint').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [index('agentDpopJti_expiresAt_idx').on(table.expiresAt)],
)
