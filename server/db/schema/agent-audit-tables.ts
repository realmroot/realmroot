import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentAuditEvent = sqliteTable(
  'agent_audit_event',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    result: text('result').notNull(),
    realmOwned: integer('realm_owned', { mode: 'boolean' }).notNull().default(false),
    ownerUserId: text('owner_user_id'),
    ownerOrganizationId: text('owner_organization_id'),
    controllerUserId: text('controller_user_id'),
    subjectIssuer: text('subject_issuer'),
    subject: text('subject'),
    agentIdentityId: text('agent_identity_id'),
    hostId: text('host_id'),
    resourceId: text('resource_id'),
    resourceConnectionId: text('resource_connection_id'),
    accessGrantId: text('access_grant_id'),
    scopes: text('scopes', { mode: 'json' }).$type<string[]>(),
    reasonCode: text('reason_code'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('agentAuditEvent_occurredAt_idx').on(table.occurredAt),
    index('agentAuditEvent_ownerUserId_idx').on(table.ownerUserId),
    index('agentAuditEvent_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('agentAuditEvent_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentAuditEvent_resourceId_idx').on(table.resourceId),
    index('agentAuditEvent_result_idx').on(table.result),
    check(
      'agentAuditEvent_exactly_one_owner_check',
      sql`((${table.realmOwned} = 1) + (${table.ownerUserId} is not null) + (${table.ownerOrganizationId} is not null)) = 1`,
    ),
  ],
)

export const ownershipQuarantine = sqliteTable(
  'ownership_quarantine',
  {
    sourceTable: text('source_table').notNull(),
    sourceId: text('source_id').notNull(),
    reasonCode: text('reason_code').notNull(),
    quarantinedAt: integer('quarantined_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index('ownershipQuarantine_source_idx').on(table.sourceTable, table.sourceId),
    check('ownershipQuarantine_source_table_check', sql`${table.sourceTable} in ('agent_audit_event')`),
  ],
)
