import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { agentIdentity, agentIdentityBinding } from './agent-identity-tables'
import { agent } from './agent-tables'
import { user } from './auth-tables'

export const agentAuthorityGrant = sqliteTable(
  'agent_authority_grant',
  {
    id: text('id').primaryKey(),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    mode: text('mode').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    audience: text('audience').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    constraints: text('constraints', { mode: 'json' }).$type<Record<string, unknown>>(),
    useCount: integer('use_count').notNull().default(0),
    status: text('status').notNull().default('active'),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('agentAuthorityGrant_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentAuthorityGrant_status_idx').on(table.status),
    index('agentAuthorityGrant_expiresAt_idx').on(table.expiresAt),
  ],
)

export const agentAuthorityApproval = sqliteTable(
  'agent_authority_approval',
  {
    id: text('id').primaryKey(),
    grantId: text('grant_id')
      .notNull()
      .references(() => agentAuthorityGrant.id, { onDelete: 'restrict' }),
    bindingId: text('binding_id')
      .notNull()
      .references(() => agentIdentityBinding.id, { onDelete: 'restrict' }),
    requestedScopes: text('requested_scopes', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status').notNull().default('pending'),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, { onDelete: 'restrict' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('agentAuthorityApproval_grantId_idx').on(table.grantId),
    index('agentAuthorityApproval_status_idx').on(table.status),
    index('agentAuthorityApproval_expiresAt_idx').on(table.expiresAt),
  ],
)

export const agentAccessToken = sqliteTable(
  'agent_access_token',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    bindingId: text('binding_id')
      .notNull()
      .references(() => agentIdentityBinding.id, { onDelete: 'restrict' }),
    protocolAgentId: text('protocol_agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'restrict' }),
    grantId: text('grant_id')
      .notNull()
      .references(() => agentAuthorityGrant.id, { onDelete: 'restrict' }),
    subjectIssuer: text('subject_issuer').notNull(),
    subject: text('subject').notNull(),
    actor: text('actor', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    audience: text('audience').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    confirmationJkt: text('confirmation_jkt').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('agentAccessToken_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentAccessToken_bindingId_idx').on(table.bindingId),
    index('agentAccessToken_grantId_idx').on(table.grantId),
    index('agentAccessToken_expiresAt_idx').on(table.expiresAt),
  ],
)

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
