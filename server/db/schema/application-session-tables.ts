import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { oauthClient, oauthRefreshToken, user } from './auth-tables'

export const applicationSession = sqliteTable(
  'application_session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastActiveAt: integer('last_active_at', { mode: 'timestamp_ms' }).notNull(),
    userAgent: text('user_agent'),
    legacy: integer('legacy', { mode: 'boolean' }).notNull().default(false),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('application_session_owner_idx').on(table.userId, table.clientId)],
)

// A separate immutable association preserves the lifecycle after SSO session deletion.
export const applicationSessionToken = sqliteTable(
  'application_session_token',
  {
    tokenId: text('token_id')
      .primaryKey()
      .references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
    applicationSessionId: text('application_session_id')
      .notNull()
      .references(() => applicationSession.id, { onDelete: 'cascade' }),
  },
  (table) => [index('application_session_token_session_idx').on(table.applicationSessionId)],
)
