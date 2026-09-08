import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { user } from './auth-tables'

// Only unfinished external cleanup lives here. Completed accounts need no job history.
export const accountDeletionCleanup = sqliteTable('account_deletion_cleanup', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'restrict' }),
  organizationIds: text('organization_ids', { mode: 'json' }).$type<string[]>().notNull(),
  assetKeys: text('asset_keys', { mode: 'json' }).$type<string[]>().notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull(),
  claimId: text('claim_id'),
  claimUntil: integer('claim_until'),
})
