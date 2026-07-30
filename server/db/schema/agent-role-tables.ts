import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agentIdentity } from './agent-identity-tables'
import { user } from './auth-tables'
import { role } from './authorization-tables'

export const agentRoleAssignment = sqliteTable(
  'agent_role_assignment',
  {
    id: text('id').primaryKey(),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    assignedByUserId: text('assigned_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('agentRoleAssignment_roleId_agentIdentityId_unique').on(table.roleId, table.agentIdentityId),
    index('agentRoleAssignment_roleId_idx').on(table.roleId),
    index('agentRoleAssignment_agentIdentityId_idx').on(table.agentIdentityId),
  ],
)
