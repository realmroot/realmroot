import type { AuthorizationDetail } from '@shared/api/authorization-details'
import type { ProviderAuthorityConstraint } from '@shared/api/external-resources'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agentIdentity, agentIdentityBinding } from './agent-identity-tables'
import { user } from './auth-tables'
import { apiResource, organization } from './authorization-tables'
import { providerConnection } from './provider-connection-tables'

export const providerResourceAuthorization = sqliteTable(
  'provider_resource_authorization',
  {
    id: text('id').primaryKey(),
    providerConnectionId: text('provider_connection_id')
      .notNull()
      .references(() => providerConnection.id, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    credentialCustody: text('credential_custody', { enum: ['realmroot', 'resource_server'] })
      .notNull()
      .default('realmroot'),
    encryptedTokens: text('encrypted_tokens'),
    brokerReference: text('broker_reference'),
    grantedScopes: text('granted_scopes', { mode: 'json' }).$type<string[]>().notNull(),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
    authorityConstraints: text('authority_constraints', { mode: 'json' })
      .$type<ProviderAuthorityConstraint[]>()
      .notNull()
      .default(sql`'[]'`),
    clientGeneration: integer('client_generation').default(1).notNull(),
    status: text('status').notNull().default('active'),
    credentialExpiresAt: integer('credential_expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    providerEventOccurredAt: integer('provider_event_occurred_at', { mode: 'timestamp_ms' }),
    providerEventRevision: integer('provider_event_revision'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    check(
      'providerResourceAuthorization_credential_custody_check',
      sql`(
        (${table.credentialCustody} = 'realmroot' AND ${table.encryptedTokens} IS NOT NULL AND ${table.brokerReference} IS NULL)
        OR
        (${table.credentialCustody} = 'resource_server' AND ${table.encryptedTokens} IS NULL AND ${table.brokerReference} IS NOT NULL)
      )`,
    ),
    uniqueIndex('providerResourceAuthorization_connection_resource_unique').on(
      table.providerConnectionId,
      table.resourceId,
    ),
    index('providerResourceAuthorization_providerConnectionId_idx').on(table.providerConnectionId),
    index('providerResourceAuthorization_resourceId_idx').on(table.resourceId),
    index('providerResourceAuthorization_status_idx').on(table.status),
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
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    initiatedByUserId: text('initiated_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
    encryptedPkceVerifier: text('encrypted_pkce_verifier').notNull(),
    authorizationMode: text('authorization_mode', { enum: ['oauth', 'brokered'] })
      .notNull()
      .default('oauth'),
    clientGeneration: integer('client_generation').default(1).notNull(),
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
    index('resourceConnectionIntent_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('resourceConnectionIntent_initiatedByUserId_idx').on(table.initiatedByUserId),
    index('resourceConnectionIntent_status_idx').on(table.status),
    index('resourceConnectionIntent_expiresAt_idx').on(table.expiresAt),
    check(
      'resourceConnectionIntent_exactly_one_owner_check',
      sql`((${table.ownerUserId} IS NOT NULL) + (${table.ownerOrganizationId} IS NOT NULL)) = 1`,
    ),
  ],
)

export const agentConnectionRequest = sqliteTable(
  'agent_connection_request',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    bindingId: text('binding_id')
      .notNull()
      .references(() => agentIdentityBinding.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
    reason: text('reason'),
    approvalTokenHash: text('approval_token_hash').notNull().unique(),
    encryptedApprovalToken: text('encrypted_approval_token').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('agentConnectionRequest_resourceId_idx').on(table.resourceId),
    index('agentConnectionRequest_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentConnectionRequest_expiresAt_idx').on(table.expiresAt),
  ],
)

export const agentAccessRequest = sqliteTable(
  'agent_access_request',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    connectionId: text('connection_id').references(() => providerResourceAuthorization.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    bindingId: text('binding_id')
      .notNull()
      .references(() => agentIdentityBinding.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
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
    connectionId: text('connection_id').references(() => providerResourceAuthorization.id, { onDelete: 'restrict' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
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
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
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
