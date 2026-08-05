import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const agentAuditEvent = sqliteTable(
  'agent_audit_event',
  {
    id: text('id').primaryKey(),
    action: text('action').notNull(),
    result: text('result').notNull(),
    controllerUserId: text('controller_user_id'),
    subjectIssuer: text('subject_issuer'),
    subject: text('subject'),
    agentIdentityId: text('agent_identity_id'),
    hostId: text('host_id'),
    ownerKind: text('owner_kind').$type<'realm' | 'organization' | 'account'>(),
    ownerId: text('owner_id'),
    quarantineReason: text('quarantine_reason'),
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
    index('agentAuditEvent_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentAuditEvent_owner_idx').on(table.ownerKind, table.ownerId),
    index('agentAuditEvent_quarantineReason_idx').on(table.quarantineReason),
    index('agentAuditEvent_resourceId_idx').on(table.resourceId),
    index('agentAuditEvent_result_idx').on(table.result),
  ],
)
