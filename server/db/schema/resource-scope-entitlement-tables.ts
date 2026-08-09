import type { AuthorizationDetail } from '@shared/api/authorization-details'
import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agentIdentity } from './agent-identity-tables'
import { user } from './auth-tables'
import { apiResource, application, organization } from './authorization-tables'
import { agentAccessRequest, providerResourceAuthorization } from './external-resource-tables'

export const resourceScopeEntitlement = sqliteTable(
  'resource_scope_entitlement',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    applicationId: text('application_id').references(() => application.id, { onDelete: 'cascade' }),
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id, { onDelete: 'restrict' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    resourceServerId: text('resource_server_id')
      .notNull()
      .references(() => apiResource.id, { onDelete: 'restrict' }),
    connectionId: text('connection_id').references(() => providerResourceAuthorization.id, { onDelete: 'restrict' }),
    authorizationDetails: text('authorization_details', { mode: 'json' })
      .$type<AuthorizationDetail[]>()
      .notNull()
      .default(sql`'[]'`),
    authorizationContextHash: text('authorization_context_hash').notNull(),
    scope: text('scope').notNull(),
    mode: text('mode', { enum: ['persistent', 'until', 'once'] }).notNull(),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    sourceAccessRequestId: text('source_access_request_id').references(() => agentAccessRequest.id, {
      onDelete: 'restrict',
    }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    endReason: text('end_reason', { enum: ['revoked', 'consumed', 'expired', 'merged'] }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('resourceScopeEntitlement_userId_idx').on(table.userId),
    index('resourceScopeEntitlement_applicationId_idx').on(table.applicationId),
    index('resourceScopeEntitlement_agentIdentityId_idx').on(table.agentIdentityId),
    index('resourceScopeEntitlement_resourceServerId_idx').on(table.resourceServerId),
    index('resourceScopeEntitlement_connectionId_idx').on(table.connectionId),
    index('resourceScopeEntitlement_sourceAccessRequestId_idx').on(table.sourceAccessRequestId),
    uniqueIndex('resourceScopeEntitlement_activeUser_unique')
      .on(
        table.userId,
        sql`coalesce(${table.organizationId}, '')`,
        table.resourceServerId,
        table.authorizationContextHash,
        table.scope,
      )
      .where(sql`${table.userId} is not null and ${table.endedAt} is null`),
    uniqueIndex('resourceScopeEntitlement_activeApplication_unique')
      .on(table.applicationId, table.resourceServerId, table.authorizationContextHash, table.scope)
      .where(sql`${table.applicationId} is not null and ${table.endedAt} is null`),
    uniqueIndex('resourceScopeEntitlement_activeAgent_unique')
      .on(
        table.agentIdentityId,
        table.resourceServerId,
        sql`coalesce(${table.connectionId}, '')`,
        table.authorizationContextHash,
        table.scope,
      )
      .where(sql`${table.agentIdentityId} is not null and ${table.endedAt} is null`),
    check(
      'resourceScopeEntitlement_exactlyOneSubject_check',
      sql`((${table.userId} is not null) + (${table.applicationId} is not null) + (${table.agentIdentityId} is not null)) = 1`,
    ),
    check(
      'resourceScopeEntitlement_userOrganization_check',
      sql`${table.organizationId} is null or ${table.userId} is not null`,
    ),
    check(
      'resourceScopeEntitlement_agentContext_check',
      sql`(${table.connectionId} is null and ${table.sourceAccessRequestId} is null) or ${table.agentIdentityId} is not null`,
    ),
    check(
      'resourceScopeEntitlement_lifetime_check',
      sql`(${table.mode} = 'until' and ${table.expiresAt} is not null) or (${table.mode} in ('persistent', 'once') and ${table.expiresAt} is null)`,
    ),
    check(
      'resourceScopeEntitlement_end_check',
      sql`(${table.endedAt} is null and ${table.endReason} is null) or (${table.endedAt} is not null and ${table.endReason} is not null)`,
    ),
  ],
)
