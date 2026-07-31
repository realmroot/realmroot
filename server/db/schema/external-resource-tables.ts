import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agentIdentity, agentIdentityBinding } from './agent-identity-tables'
import { user } from './auth-tables'
import { apiResource, organization } from './authorization-tables'

export const resourceAccountConnection = sqliteTable(
  'resource_account_connection',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    externalSubject: text('external_subject').notNull(),
    displayName: text('display_name').notNull(),
    encryptedTokens: text('encrypted_tokens').notNull(),
    grantedScopes: text('granted_scopes', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status').notNull().default('active'),
    credentialExpiresAt: integer('credential_expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    check(
      'resourceAccountConnection_exactly_one_owner_check',
      sql`((${table.ownerUserId} IS NOT NULL) + (${table.ownerOrganizationId} IS NOT NULL)) = 1`,
    ),
    uniqueIndex('resourceAccountConnection_resource_user_unique')
      .on(table.resourceId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    uniqueIndex('resourceAccountConnection_resource_org_unique')
      .on(table.resourceId, table.ownerOrganizationId)
      .where(sql`${table.ownerOrganizationId} IS NOT NULL`),
    index('resourceAccountConnection_resourceId_idx').on(table.resourceId),
    index('resourceAccountConnection_ownerUserId_idx').on(table.ownerUserId),
    index('resourceAccountConnection_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('resourceAccountConnection_status_idx').on(table.status),
  ],
)

export const resourceConnectionIntent = sqliteTable(
  'resource_connection_intent',
  {
    id: text('id').primaryKey(),
    stateHash: text('state_hash').notNull().unique(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    encryptedPkceVerifier: text('encrypted_pkce_verifier').notNull(),
    returnTo: text('return_to').notNull().default('account-center'),
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
    index('resourceConnectionIntent_resourceId_idx').on(table.resourceId),
    index('resourceConnectionIntent_ownerUserId_idx').on(table.ownerUserId),
    index('resourceConnectionIntent_status_idx').on(table.status),
    index('resourceConnectionIntent_expiresAt_idx').on(table.expiresAt),
  ],
)

export const agentAccessRequest = sqliteTable(
  'agent_access_request',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    connectionId: text('connection_id').references(() => resourceAccountConnection.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    bindingId: text('binding_id')
      .notNull()
      .references(() => agentIdentityBinding.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    reason: text('reason'),
    status: text('status').notNull().default('pending'),
    approvalTokenHash: text('approval_token_hash').notNull().unique(),
    encryptedApprovalToken: text('encrypted_approval_token').notNull(),
    grantId: text('grant_id'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('agentAccessRequest_resourceId_idx').on(table.resourceId),
    index('agentAccessRequest_connectionId_idx').on(table.connectionId),
    index('agentAccessRequest_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentAccessRequest_status_idx').on(table.status),
    index('agentAccessRequest_expiresAt_idx').on(table.expiresAt),
  ],
)

export const agentAccessGrant = sqliteTable(
  'agent_access_grant',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    connectionId: text('connection_id').references(() => resourceAccountConnection.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    mode: text('mode').notNull(),
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
    index('agentAccessGrant_resourceId_idx').on(table.resourceId),
    index('agentAccessGrant_connectionId_idx').on(table.connectionId),
    index('agentAccessGrant_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentAccessGrant_status_idx').on(table.status),
  ],
)

export const externalTokenLease = sqliteTable(
  'external_token_lease',
  {
    id: text('id').primaryKey(),
    grantId: text('grant_id')
      .notNull()
      .references(() => agentAccessGrant.id, { onDelete: 'restrict' }),
    requestId: text('request_id')
      .notNull()
      .references(() => agentAccessRequest.id, { onDelete: 'restrict' }),
    bindingId: text('binding_id')
      .notNull()
      .references(() => agentIdentityBinding.id, { onDelete: 'restrict' }),
    encryptedAccessToken: text('encrypted_access_token').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    confirmationJkt: text('confirmation_jkt').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('externalTokenLease_grantId_idx').on(table.grantId),
    index('externalTokenLease_bindingId_idx').on(table.bindingId),
    index('externalTokenLease_expiresAt_idx').on(table.expiresAt),
  ],
)
