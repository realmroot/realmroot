import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const identityProviderConnector = sqliteTable(
  'identity_provider_connector',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    providerType: text('provider_type').notNull(),
    providerId: text('provider_id').notNull(),
    displayName: text('display_name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    authenticationEnabled: integer('authentication_enabled', { mode: 'boolean' }).default(true).notNull(),
    clientId: text('client_id'),
    clientSecret: text('client_secret'),
    clientSecretContext: text('client_secret_context'),
    issuer: text('issuer'),
    authorizationEndpoint: text('authorization_endpoint'),
    tokenEndpoint: text('token_endpoint'),
    userInfoEndpoint: text('user_info_endpoint'),
    jwksEndpoint: text('jwks_endpoint'),
    registrationEndpoint: text('registration_endpoint'),
    revocationEndpoint: text('revocation_endpoint'),
    registrationMode: text('registration_mode'),
    registrationClientUri: text('registration_client_uri'),
    registrationAccessToken: text('registration_access_token'),
    registrationAccessTokenContext: text('registration_access_token_context'),
    registeredScopes: text('registered_scopes', { mode: 'json' }).$type<string[]>(),
    clientGeneration: integer('client_generation').default(1).notNull(),
    retiredClientGenerations: text('retired_client_generations', { mode: 'json' }).$type<
      Array<{
        generation: number
        clientId: string
        encryptedClientSecret: string
        clientSecretContext: string
        registrationClientUri: string | null
        encryptedRegistrationAccessToken: string | null
        registrationAccessTokenContext: string | null
        registeredScopes: string[]
      }>
    >(),
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
    index('identityProviderConnector_authenticationEnabled_idx').on(table.authenticationEnabled),
  ],
)
