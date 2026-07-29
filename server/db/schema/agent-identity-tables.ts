import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agent } from './agent-tables'
import { user } from './auth-tables'
import { organization } from './authorization-tables'

export const agentIdentity = sqliteTable(
  'agent_identity',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    name: text('name').notNull(),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    retiredAt: integer('retired_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('agentIdentity_issuer_subject_unique').on(table.issuer, table.subject),
    index('agentIdentity_ownerUserId_idx').on(table.ownerUserId),
    index('agentIdentity_ownerOrganizationId_idx').on(table.ownerOrganizationId),
    index('agentIdentity_status_idx').on(table.status),
    check(
      'agentIdentity_exactly_one_owner_check',
      sql`((${table.ownerUserId} is not null) + (${table.ownerOrganizationId} is not null)) = 1`,
    ),
  ],
)

export const agentIdentityBinding = sqliteTable(
  'agent_identity_binding',
  {
    id: text('id').primaryKey(),
    agentIdentityId: text('agent_identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'restrict' }),
    protocolAgentId: text('protocol_agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'),
    boundAt: integer('bound_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('agentIdentityBinding_protocolAgentId_unique').on(table.protocolAgentId),
    index('agentIdentityBinding_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentIdentityBinding_status_idx').on(table.status),
  ],
)

export const agentEnrollmentIntent = sqliteTable(
  'agent_enrollment_intent',
  {
    id: text('id').primaryKey(),
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id, { onDelete: 'restrict' }),
    requestedName: text('requested_name'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'restrict' }),
    ownerOrganizationId: text('owner_organization_id').references(() => organization.id, { onDelete: 'restrict' }),
    protocolAgentId: text('protocol_agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('pending'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    approvedByUserId: text('approved_by_user_id').references(() => user.id, { onDelete: 'restrict' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('agentEnrollmentIntent_agentIdentityId_idx').on(table.agentIdentityId),
    index('agentEnrollmentIntent_protocolAgentId_idx').on(table.protocolAgentId),
    index('agentEnrollmentIntent_status_idx').on(table.status),
    index('agentEnrollmentIntent_expiresAt_idx').on(table.expiresAt),
    check(
      'agentEnrollmentIntent_exactly_one_owner_check',
      sql`((${table.ownerUserId} is not null) + (${table.ownerOrganizationId} is not null)) = 1`,
    ),
    check(
      'agentEnrollmentIntent_new_or_existing_identity_check',
      sql`(${table.agentIdentityId} is not null) or (${table.requestedName} is not null)`,
    ),
  ],
)
