import type { ResourceScopeRegistry } from '@shared/api/authorization'
import type { AuthorizationDetail } from '@shared/api/authorization-details'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { uploadedAsset } from './agent-tables'
import { oauthClient, user } from './auth-tables'
import { identityProviderConnector } from './connector-tables'

export const organization = sqliteTable(
  'organization',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    logo: text('logo'),
    displayName: text('display_name'),
    logoAssetId: text('logo_asset_id').references(() => uploadedAsset.id, { onDelete: 'set null' }),
    disabled: integer('disabled', { mode: 'boolean' }).default(false).notNull(),
    disabledReason: text('disabled_reason'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('organization_logoAssetId_idx').on(table.logoAssetId)],
)

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    title: text('title'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('member_organizationId_userId_unique').on(table.organizationId, table.userId),
    index('member_userId_idx').on(table.userId),
    index('member_role_idx').on(table.role),
  ],
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    inviterId: text('inviter_id').references(() => user.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'),
    tokenHash: text('token_hash').unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
    index('invitation_inviterId_idx').on(table.inviterId),
  ],
)

export const application = sqliteTable(
  'application',
  {
    id: text('id').primaryKey(),
    oauthClientId: text('oauth_client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    homepageUrl: text('homepage_url'),
    logoAssetId: text('logo_asset_id').references(() => uploadedAsset.id, { onDelete: 'set null' }),
    ownerOrganizationId: text('owner_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    oidcScopes: text('oidc_scopes', { mode: 'json' })
      .$type<Array<'openid' | 'profile' | 'email' | 'offline_access'>>()
      .notNull()
      .default(sql`'["openid","profile","email"]'`),
    resourceScopes: text('resource_scopes', { mode: 'json' })
      .$type<Array<{ resourceServerId: string; scopes: string[] }>>()
      .notNull()
      .default(sql`'[]'`),
    firstParty: integer('first_party', { mode: 'boolean' }).default(false).notNull(),
    trusted: integer('trusted', { mode: 'boolean' }).default(false).notNull(),
    disabled: integer('disabled', { mode: 'boolean' }).default(false).notNull(),
    disabledReason: text('disabled_reason'),
    accessTokenTtlSeconds: integer('access_token_ttl_seconds'),
    refreshTokenTtlSeconds: integer('refresh_token_ttl_seconds'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('application_oauthClientId_unique').on(table.oauthClientId),
    index('application_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('application_disabled_idx').on(table.disabled),
  ],
)

export const applicationClientMetadata = sqliteTable('application_client_metadata', {
  applicationId: text('application_id')
    .primaryKey()
    .references(() => application.id, { onDelete: 'cascade' }),
  accessReviewStatus: text('access_review_status').notNull().default('pending'),
  accessReviewNotes: text('access_review_notes'),
  allowedEnvironments: text('allowed_environments', { mode: 'json' }).$type<string[]>(),
  adminMetadata: text('admin_metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const applicationClientSecret = sqliteTable(
  'application_client_secret',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    secretHash: text('secret_hash').notNull(),
    secretPrefix: text('secret_prefix'),
    status: text('status').notNull().default('active'),
    materializedToOauthClientAt: integer('materialized_to_oauth_client_at', { mode: 'timestamp_ms' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('applicationClientSecret_applicationId_version_unique').on(table.applicationId, table.version),
    index('applicationClientSecret_applicationId_status_idx').on(table.applicationId, table.status),
    index('applicationClientSecret_createdByUserId_idx').on(table.createdByUserId),
  ],
)

export const apiResource = sqliteTable(
  'api_resource',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull().unique(),
    name: text('name').notNull(),
    resourceUrl: text('resource_url').notNull(),
    connectorId: text('connector_id').references(() => identityProviderConnector.id, {
      onDelete: 'restrict',
    }),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
    description: text('description'),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    ownerOrganizationId: text('owner_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    visibility: text('visibility', { enum: ['private', 'public'] })
      .notNull()
      .default('private'),
    scopeRegistry: text('scope_registry', { mode: 'json' }).$type<ResourceScopeRegistry | null>(),
    availableToAgents: integer('available_to_agents', { mode: 'boolean' }).default(true).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('apiResource_resourceUrl_unique').on(table.resourceUrl),
    index('apiResource_enabled_idx').on(table.enabled),
    index('apiResource_connectorId_idx').on(table.connectorId),
    index('apiResource_ownerOrganizationId_idx').on(table.ownerOrganizationId),
  ],
)

export const applicationConsent = sqliteTable(
  'application_consent',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    resourceServerId: text('resource_server_id').references(() => apiResource.id, { onDelete: 'cascade' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    permissions: text('permissions', { mode: 'json' }).$type<string[]>(),
    grantedAt: integer('granted_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('applicationConsent_applicationId_idx').on(table.applicationId),
    index('applicationConsent_userId_idx').on(table.userId),
    index('applicationConsent_resourceServerId_idx').on(table.resourceServerId),
    uniqueIndex('applicationConsent_activePrincipalResource_unique')
      .on(table.applicationId, table.userId, table.resourceServerId)
      .where(sql`${table.revokedAt} is null and ${table.resourceServerId} is not null`),
    uniqueIndex('applicationConsent_activeOidcPrincipal_unique')
      .on(table.applicationId, table.userId)
      .where(sql`${table.revokedAt} is null and ${table.resourceServerId} is null`),
  ],
)

export const userScopeGrant = sqliteTable(
  'user_scope_grant',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    resourceServerId: text('resource_server_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'cascade' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('userScopeGrant_userId_idx').on(table.userId),
    index('userScopeGrant_resourceServerId_idx').on(table.resourceServerId),
    index('userScopeGrant_organizationId_idx').on(table.organizationId),
  ],
)

export const applicationScopeGrant = sqliteTable(
  'application_scope_grant',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    resourceServerId: text('resource_server_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'cascade' }),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('applicationScopeGrant_applicationId_idx').on(table.applicationId),
    index('applicationScopeGrant_resourceServerId_idx').on(table.resourceServerId),
  ],
)

export const organizationRole = sqliteTable(
  'organization_role',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    permission: text('permission', { mode: 'json' }).$type<Record<string, string[]>>().notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('organizationRole_organizationId_role_unique').on(table.organizationId, table.role),
    index('organizationRole_organizationId_idx').on(table.organizationId),
  ],
)

// Workload identity federation (RFC 8693 token exchange). A federated credential
// is a child of an Application: an external issuer + subject whose self-signed
// assertions are exchanged for a token that represents THIS application (not the
// external subject). The trust belongs to the application principal — never a
// global registry — so its blast radius is exactly that one application.
export const federatedCredential = sqliteTable(
  'federated_credential',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Logical issuer identity (matches the subject token `iss`). Opaque key, not
    // dereferenced; keep stable and decoupled from transport/host/port.
    issuer: text('issuer').notNull(),
    // Allowed subject (exact, or a trailing-`*` prefix pattern e.g. `machine:*`).
    subject: text('subject').notNull(),
    // The minted token's audience comes from this registered API resource.
    audienceResourceId: text('audience_resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    // Asymmetric verification (preferred): a JWKS endpoint to fetch, or an inline
    // static JWK set (for issuers that are not publicly reachable, e.g. local dev).
    jwksUrl: text('jwks_url'),
    publicKeys: text('public_keys', { mode: 'json' }).$type<Record<string, unknown>[] | null>(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('federatedCredential_app_issuer_subject_unique').on(table.applicationId, table.issuer, table.subject),
    index('federatedCredential_issuer_idx').on(table.issuer),
    index('federatedCredential_applicationId_idx').on(table.applicationId),
    index('federatedCredential_enabled_idx').on(table.enabled),
  ],
)

// Audit log of minted token-exchange access tokens (also used for introspection).
export const tokenExchangeAccessToken = sqliteTable(
  'token_exchange_access_token',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    credentialId: text('credential_id')
      .notNull()
      .references(() => federatedCredential.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    subjectTokenIssuer: text('subject_token_issuer').notNull(),
    audience: text('audience').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    claims: text('claims', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('tokenExchangeAccessToken_clientId_idx').on(table.clientId),
    index('tokenExchangeAccessToken_credentialId_idx').on(table.credentialId),
    index('tokenExchangeAccessToken_expiresAt_idx').on(table.expiresAt),
  ],
)

// One-time refresh tokens for RFC 8693 exchanges. A family is revoked when a
// consumed token is replayed so theft cannot remain silent.
export const tokenExchangeRefreshToken = sqliteTable(
  'token_exchange_refresh_token',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    credentialId: text('credential_id')
      .notNull()
      .references(() => federatedCredential.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    subjectTokenIssuer: text('subject_token_issuer').notNull(),
    audience: text('audience').notNull(),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>().notNull(),
    claims: text('claims', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('tokenExchangeRefreshToken_familyId_idx').on(table.familyId),
    index('tokenExchangeRefreshToken_clientId_idx').on(table.clientId),
    index('tokenExchangeRefreshToken_credentialId_idx').on(table.credentialId),
    index('tokenExchangeRefreshToken_expiresAt_idx').on(table.expiresAt),
  ],
)
