import { relations, sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').unique(),
  displayUsername: text('display_username'),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  avatarAssetId: text('avatar_asset_id'),
  role: text('role'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('ban_reason'),
  banExpires: integer('ban_expires', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: text('active_organization_id'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const oauthClient = sqliteTable(
  'oauth_client',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    skipConsent: integer('skip_consent', { mode: 'boolean' }),
    enableEndSession: integer('enable_end_session', { mode: 'boolean' }),
    subjectType: text('subject_type'),
    scopes: text('scopes'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts'),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    grantTypes: text('grant_types'),
    responseTypes: text('response_types'),
    public: integer('public', { mode: 'boolean' }),
    type: text('type'),
    requirePKCE: integer('require_pkce', { mode: 'boolean' }),
    referenceId: text('reference_id'),
    metadata: text('metadata'),
  },
  (table) => [
    index('oauthClient_userId_idx').on(table.userId),
    index('oauthClient_referenceId_idx').on(table.referenceId),
  ],
)

export const oauthRefreshToken = sqliteTable(
  'oauth_refresh_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    revoked: integer('revoked', { mode: 'timestamp_ms' }),
    authTime: integer('auth_time', { mode: 'timestamp_ms' }),
    scopes: text('scopes').notNull(),
  },
  (table) => [
    index('oauthRefreshToken_clientId_idx').on(table.clientId),
    index('oauthRefreshToken_sessionId_idx').on(table.sessionId),
    index('oauthRefreshToken_userId_idx').on(table.userId),
  ],
)

export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    scopes: text('scopes').notNull(),
  },
  (table) => [
    index('oauthAccessToken_clientId_idx').on(table.clientId),
    index('oauthAccessToken_sessionId_idx').on(table.sessionId),
    index('oauthAccessToken_userId_idx').on(table.userId),
    index('oauthAccessToken_refreshId_idx').on(table.refreshId),
  ],
)

export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    scopes: text('scopes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('oauthConsent_clientId_idx').on(table.clientId),
    index('oauthConsent_userId_idx').on(table.userId),
    index('oauthConsent_referenceId_idx').on(table.referenceId),
  ],
)

export const uploadedAsset = sqliteTable(
  'uploaded_asset',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    publicUrl: text('public_url'),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksumSha256: text('checksum_sha256'),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('uploadedAsset_purpose_idx').on(table.purpose),
    index('uploadedAsset_createdByUserId_idx').on(table.createdByUserId),
  ],
)

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
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
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
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'set null' }),
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
    index('application_ownerUserId_idx').on(table.ownerUserId),
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
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
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
    index('applicationConsent_organizationId_idx').on(table.organizationId),
  ],
)

export const apiResource = sqliteTable(
  'api_resource',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull().unique(),
    name: text('name').notNull(),
    audience: text('audience').notNull(),
    description: text('description'),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    tokenClaimsNamespace: text('token_claims_namespace'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('apiResource_enabled_idx').on(table.enabled)],
)

export const apiScope = sqliteTable(
  'api_scope',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    description: text('description'),
    required: integer('required', { mode: 'boolean' }).default(false).notNull(),
    tokenClaimName: text('token_claim_name'),
    includeInAccessToken: integer('include_in_access_token', { mode: 'boolean' }).default(true).notNull(),
    includeInIdToken: integer('include_in_id_token', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => [
    uniqueIndex('apiScope_resourceId_value_unique').on(table.resourceId, table.value),
    index('apiScope_resourceId_idx').on(table.resourceId),
  ],
)

export const apiPermission = sqliteTable(
  'api_permission',
  {
    id: text('id').primaryKey(),
    resourceId: text('resource_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'cascade' }),
    scopeId: text('scope_id').references(() => apiScope.id, { onDelete: 'set null' }),
    key: text('key').notNull(),
    description: text('description'),
    tokenClaimValue: text('token_claim_value'),
  },
  (table) => [
    uniqueIndex('apiPermission_resourceId_key_unique').on(table.resourceId, table.key),
    index('apiPermission_scopeId_idx').on(table.scopeId),
  ],
)

export const role = sqliteTable(
  'role',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    resourceId: text('resource_id').references(() => apiResource.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    applicationId: text('application_id').references(() => application.id, { onDelete: 'cascade' }),
    system: integer('system', { mode: 'boolean' }).default(false).notNull(),
    tokenClaimName: text('token_claim_name'),
    tokenClaimValue: text('token_claim_value'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('role_key_idx').on(table.key),
    index('role_resourceId_idx').on(table.resourceId),
    index('role_organizationId_idx').on(table.organizationId),
    index('role_applicationId_idx').on(table.applicationId),
  ],
)

export const rolePermission = sqliteTable(
  'role_permission',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => apiPermission.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [uniqueIndex('rolePermission_roleId_permissionId_unique').on(table.roleId, table.permissionId)],
)

export const userRoleAssignment = sqliteTable(
  'user_role_assignment',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    assignedByUserId: text('assigned_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    tokenClaims: text('token_claims', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('userRoleAssignment_roleId_userId_unique').on(table.roleId, table.userId),
    index('userRoleAssignment_roleId_idx').on(table.roleId),
    index('userRoleAssignment_userId_idx').on(table.userId),
  ],
)

export const applicationRoleAssignment = sqliteTable(
  'application_role_assignment',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    applicationId: text('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    assignedByUserId: text('assigned_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    tokenClaims: text('token_claims', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('applicationRoleAssignment_roleId_applicationId_unique').on(table.roleId, table.applicationId),
    index('applicationRoleAssignment_roleId_idx').on(table.roleId),
    index('applicationRoleAssignment_applicationId_idx').on(table.applicationId),
  ],
)

export const memberRoleAssignment = sqliteTable(
  'member_role_assignment',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    assignedByUserId: text('assigned_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    tokenClaims: text('token_claims', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('memberRoleAssignment_roleId_memberId_unique').on(table.roleId, table.memberId),
    index('memberRoleAssignment_roleId_idx').on(table.roleId),
    index('memberRoleAssignment_memberId_idx').on(table.memberId),
  ],
)

export const identityProviderConnector = sqliteTable(
  'identity_provider_connector',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    providerType: text('provider_type').notNull(),
    providerId: text('provider_id').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    clientId: text('client_id'),
    clientSecretBinding: text('client_secret_binding'),
    issuer: text('issuer'),
    authorizationEndpoint: text('authorization_endpoint'),
    tokenEndpoint: text('token_endpoint'),
    userInfoEndpoint: text('user_info_endpoint'),
    jwksEndpoint: text('jwks_endpoint'),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>(),
    attributeMapping: text('attribute_mapping', { mode: 'json' }).$type<Record<string, string>>(),
    providerMetadata: text('provider_metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('identityProviderConnector_providerType_idx').on(table.providerType),
    index('identityProviderConnector_enabled_idx').on(table.enabled),
  ],
)

export const emailServiceConfig = sqliteTable('email_service_config', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('cloudflare_email'),
  enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name'),
  replyToEmail: text('reply_to_email'),
  defaultLocale: text('default_locale'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const signInExperience = sqliteTable('sign_in_experience', {
  id: text('id').primaryKey(),
  defaultApplicationId: text('default_application_id').references(() => application.id, { onDelete: 'set null' }),
  passwordEnabled: integer('password_enabled', { mode: 'boolean' }).default(true).notNull(),
  signupEnabled: integer('signup_enabled', { mode: 'boolean' }).default(true).notNull(),
  socialLoginEnabled: integer('social_login_enabled', { mode: 'boolean' }).default(true).notNull(),
  identifierFirst: integer('identifier_first', { mode: 'boolean' }).default(false).notNull(),
  defaultRedirectUri: text('default_redirect_uri'),
  termsUri: text('terms_uri'),
  privacyUri: text('privacy_uri'),
  supportEmail: text('support_email'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const brandingSetting = sqliteTable(
  'branding_setting',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id').references(() => application.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    logoAssetId: text('logo_asset_id').references(() => uploadedAsset.id, { onDelete: 'set null' }),
    faviconAssetId: text('favicon_asset_id').references(() => uploadedAsset.id, { onDelete: 'set null' }),
    primaryColor: text('primary_color'),
    backgroundColor: text('background_color'),
    customCss: text('custom_css'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('brandingSetting_applicationId_idx').on(table.applicationId),
    index('brandingSetting_organizationId_idx').on(table.organizationId),
  ],
)

export const accountCenterSetting = sqliteTable(
  'account_center_setting',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id').references(() => application.id, { onDelete: 'cascade' }),
    profileEditingEnabled: integer('profile_editing_enabled', { mode: 'boolean' }).default(true).notNull(),
    passwordChangeEnabled: integer('password_change_enabled', { mode: 'boolean' }).default(true).notNull(),
    connectedAccountsEnabled: integer('connected_accounts_enabled', { mode: 'boolean' }).default(true).notNull(),
    sessionsViewEnabled: integer('sessions_view_enabled', { mode: 'boolean' }).default(true).notNull(),
    dangerZoneEnabled: integer('danger_zone_enabled', { mode: 'boolean' }).default(false).notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index('accountCenterSetting_applicationId_idx').on(table.applicationId)],
)

export const deploymentSetting = sqliteTable('deployment_setting', {
  id: text('id').primaryKey(),
  environment: text('environment').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  issuerPath: text('issuer_path').notNull().default('/api/auth'),
  cookieDomain: text('cookie_domain'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
})

export const customDomain = sqliteTable(
  'custom_domain',
  {
    id: text('id').primaryKey(),
    hostname: text('hostname').notNull().unique(),
    applicationId: text('application_id').references(() => application.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    verificationToken: text('verification_token').notNull().unique(),
    cnameTarget: text('cname_target'),
    tlsStatus: text('tls_status'),
    verifiedAt: integer('verified_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('customDomain_applicationId_idx').on(table.applicationId),
    index('customDomain_organizationId_idx').on(table.organizationId),
    index('customDomain_status_idx').on(table.status),
  ],
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  oauthClients: many(oauthClient),
  oauthRefreshTokens: many(oauthRefreshToken),
  oauthAccessTokens: many(oauthAccessToken),
  oauthConsents: many(oauthConsent),
  ownedApplications: many(application),
  organizationMemberships: many(member),
  roleAssignments: many(userRoleAssignment),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const organizationRelations = relations(organization, ({ many, one }) => ({
  logoAsset: one(uploadedAsset, {
    fields: [organization.logoAssetId],
    references: [uploadedAsset.id],
  }),
  members: many(member),
  invitations: many(invitation),
  applications: many(application),
  roles: many(role),
}))

export const organizationMemberRelations = relations(member, ({ one, many }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
  roleAssignments: many(memberRoleAssignment),
}))

export const applicationRelations = relations(application, ({ one, many }) => ({
  oauthClient: one(oauthClient, {
    fields: [application.oauthClientId],
    references: [oauthClient.clientId],
  }),
  ownerUser: one(user, {
    fields: [application.ownerUserId],
    references: [user.id],
  }),
  ownerOrganization: one(organization, {
    fields: [application.ownerOrganizationId],
    references: [organization.id],
  }),
  logoAsset: one(uploadedAsset, {
    fields: [application.logoAssetId],
    references: [uploadedAsset.id],
  }),
  clientSecrets: many(applicationClientSecret),
  consents: many(applicationConsent),
  roleAssignments: many(applicationRoleAssignment),
}))

export const apiResourceRelations = relations(apiResource, ({ many }) => ({
  scopes: many(apiScope),
  permissions: many(apiPermission),
  roles: many(role),
}))

export const apiScopeRelations = relations(apiScope, ({ one, many }) => ({
  resource: one(apiResource, {
    fields: [apiScope.resourceId],
    references: [apiResource.id],
  }),
  permissions: many(apiPermission),
}))

export const apiPermissionRelations = relations(apiPermission, ({ one, many }) => ({
  resource: one(apiResource, {
    fields: [apiPermission.resourceId],
    references: [apiResource.id],
  }),
  scope: one(apiScope, {
    fields: [apiPermission.scopeId],
    references: [apiScope.id],
  }),
  rolePermissions: many(rolePermission),
}))

export const roleRelations = relations(role, ({ one, many }) => ({
  resource: one(apiResource, {
    fields: [role.resourceId],
    references: [apiResource.id],
  }),
  organization: one(organization, {
    fields: [role.organizationId],
    references: [organization.id],
  }),
  application: one(application, {
    fields: [role.applicationId],
    references: [application.id],
  }),
  permissions: many(rolePermission),
  userAssignments: many(userRoleAssignment),
  applicationAssignments: many(applicationRoleAssignment),
  memberAssignments: many(memberRoleAssignment),
}))

export const rolePermissionRelations = relations(rolePermission, ({ one }) => ({
  role: one(role, {
    fields: [rolePermission.roleId],
    references: [role.id],
  }),
  permission: one(apiPermission, {
    fields: [rolePermission.permissionId],
    references: [apiPermission.id],
  }),
}))

export const userRoleAssignmentRelations = relations(userRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [userRoleAssignment.roleId],
    references: [role.id],
  }),
  user: one(user, {
    fields: [userRoleAssignment.userId],
    references: [user.id],
  }),
}))

export const applicationRoleAssignmentRelations = relations(applicationRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [applicationRoleAssignment.roleId],
    references: [role.id],
  }),
  application: one(application, {
    fields: [applicationRoleAssignment.applicationId],
    references: [application.id],
  }),
}))

export const memberRoleAssignmentRelations = relations(memberRoleAssignment, ({ one }) => ({
  role: one(role, {
    fields: [memberRoleAssignment.roleId],
    references: [role.id],
  }),
  member: one(member, {
    fields: [memberRoleAssignment.memberId],
    references: [member.id],
  }),
}))
