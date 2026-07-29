import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { uploadedAsset } from './agent-tables'
import { user } from './auth-tables'
import { application, organization } from './authorization-tables'

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
    clientSecret: text('client_secret'),
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
    uniqueIndex('identityProviderConnector_providerId_unique').on(table.providerId),
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

export const webhookEndpoint = sqliteTable(
  'webhook_endpoint',
  {
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    events: text('events', { mode: 'json' }).$type<string[]>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    signingSecret: text('signing_secret').notNull(),
    secretPrefix: text('secret_prefix').notNull(),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('webhookEndpoint_enabled_idx').on(table.enabled),
    index('webhookEndpoint_createdByUserId_idx').on(table.createdByUserId),
  ],
)

export const webhookDeliveryRequest = sqliteTable(
  'webhook_delivery_request',
  {
    id: text('id').primaryKey(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoint.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    httpStatus: integer('http_status'),
    error: text('error'),
    requestBody: text('request_body'),
    responseBody: text('response_body'),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('webhookDeliveryRequest_endpointId_idx').on(table.endpointId),
    index('webhookDeliveryRequest_status_idx').on(table.status),
    index('webhookDeliveryRequest_createdAt_idx').on(table.createdAt),
  ],
)

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
    logoUrl: text('logo_url'),
    faviconUrl: text('favicon_url'),
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
