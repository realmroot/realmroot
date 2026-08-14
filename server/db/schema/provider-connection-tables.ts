import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { account, user } from './auth-tables'
import { organization } from './authorization-tables'
import { identityProviderConnector } from './connector-tables'

export const providerConnection = sqliteTable(
  'provider_connection',
  {
    id: text('id').primaryKey(),
    connectorId: text('connector_id')
      .notNull()
      .references(() => identityProviderConnector.id, { onDelete: 'restrict' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    authenticationAccountId: text('authentication_account_id').references(() => account.id, { onDelete: 'set null' }),
    externalSubject: text('external_subject').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: ['active', 'suspended', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      'providerConnection_exactly_one_owner_check',
      sql`((${table.ownerUserId} IS NOT NULL) + (${table.ownerOrganizationId} IS NOT NULL)) = 1`,
    ),
    uniqueIndex('providerConnection_connector_user_unique')
      .on(table.connectorId, table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`),
    uniqueIndex('providerConnection_connector_org_unique')
      .on(table.connectorId, table.ownerOrganizationId)
      .where(sql`${table.ownerOrganizationId} IS NOT NULL`),
    uniqueIndex('providerConnection_authenticationAccountId_unique').on(table.authenticationAccountId),
    index('providerConnection_connectorId_idx').on(table.connectorId),
    index('providerConnection_ownerUserId_idx').on(table.ownerUserId),
    index('providerConnection_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('providerConnection_status_idx').on(table.status),
  ],
)
