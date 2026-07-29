import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agentIdentity } from './agent-identity-tables'
import { user } from './auth-tables'
import { organization } from './authorization-tables'
import { identityProviderConnector } from './settings-tables'

export const externalAccount = sqliteTable(
  'external_account',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => identityProviderConnector.id, { onDelete: 'restrict' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    ownerAgentIdentityId: text('owner_agent_identity_id').references(() => agentIdentity.id, {
      onDelete: 'restrict',
    }),
    externalSubject: text('external_subject'),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('active'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    check(
      'externalAccount_exactly_one_owner_check',
      sql`((${table.ownerUserId} IS NOT NULL) + (${table.ownerOrganizationId} IS NOT NULL) + (${table.ownerAgentIdentityId} IS NOT NULL)) = 1`,
    ),
    index('externalAccount_connectorId_idx').on(table.connectorId),
    index('externalAccount_ownerUserId_idx').on(table.ownerUserId),
    index('externalAccount_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('externalAccount_ownerAgentIdentityId_idx').on(table.ownerAgentIdentityId),
    index('externalAccount_status_idx').on(table.status),
    uniqueIndex('externalAccount_connectorId_externalSubject_unique').on(table.connectorId, table.externalSubject),
  ],
)

export const externalCredential = sqliteTable(
  'external_credential',
  {
    id: text('id').primaryKey(),
    externalAccountId: text('external_account_id')
      .notNull()
      .references(() => externalAccount.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex('externalCredential_externalAccountId_unique').on(table.externalAccountId),
    index('externalCredential_status_idx').on(table.status),
    index('externalCredential_expiresAt_idx').on(table.expiresAt),
  ],
)

export const externalAccountGrant = sqliteTable(
  'external_account_grant',
  {
    id: text('id').primaryKey(),
    externalAccountId: text('external_account_id')
      .notNull()
      .references(() => externalAccount.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    allowedMethods: text('allowed_methods', { mode: 'json' }).$type<string[]>().notNull(),
    allowedPathPrefixes: text('allowed_path_prefixes', { mode: 'json' }).$type<string[]>().notNull(),
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
    uniqueIndex('externalAccountGrant_account_agent_unique').on(table.externalAccountId, table.agentIdentityId),
    index('externalAccountGrant_agentIdentityId_idx').on(table.agentIdentityId),
    index('externalAccountGrant_status_idx').on(table.status),
  ],
)

export const externalOAuthIntent = sqliteTable(
  'external_oauth_intent',
  {
    id: text('id').primaryKey(),
    stateHash: text('state_hash').notNull().unique(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => identityProviderConnector.id, { onDelete: 'restrict' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    encryptedPkceVerifier: text('encrypted_pkce_verifier').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('externalOAuthIntent_connectorId_idx').on(table.connectorId),
    index('externalOAuthIntent_ownerUserId_idx').on(table.ownerUserId),
    index('externalOAuthIntent_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('externalOAuthIntent_status_idx').on(table.status),
    index('externalOAuthIntent_expiresAt_idx').on(table.expiresAt),
  ],
)
