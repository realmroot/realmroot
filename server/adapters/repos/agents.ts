import { badRequest, forbidden, notFound } from '@server/domain/errors'
import type { AgentRepository } from '@server/usecases/ports'
import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import type { PaginatedResult, PaginationInput } from '../../../shared/api/pagination'
import type { Database } from '../../db/client'
import { agent, agentAuditEvent, agentCapabilityGrant, agentHost, approvalRequest } from '../../db/schema'

export type AgentHostRecord = typeof agentHost.$inferSelect
export type AgentRecord = typeof agent.$inferSelect
export type AgentCapabilityGrantRecord = typeof agentCapabilityGrant.$inferSelect
export type ApprovalRequestRecord = typeof approvalRequest.$inferSelect

export function createDrizzleAgentRepository(db: Database): AgentRepository {
  return {
    async listHosts(page) {
      return list(db, agentHost, page, desc(agentHost.createdAt))
    },

    async listAgents(page) {
      return list(db, agent, page, desc(agent.createdAt))
    },

    async listCapabilityGrants(page) {
      return list(db, agentCapabilityGrant, page, desc(agentCapabilityGrant.createdAt))
    },

    async listApprovalRequests(page) {
      return list(db, approvalRequest, page, desc(approvalRequest.createdAt))
    },

    async findApprovalRequest(id) {
      const [record] = await db.select().from(approvalRequest).where(eq(approvalRequest.id, id)).limit(1)
      return record ?? null
    },

    async createApprovalRequest(record) {
      await db.insert(approvalRequest).values(record)
      return record
    },

    async listAgentsForUser(userId, page) {
      return list(db, agent, page, desc(agent.createdAt), and(eq(agent.userId, userId), eq(agent.status, 'active')))
    },

    async listHostsForAgents(hostIds) {
      if (hostIds.length === 0) return []
      return db.select().from(agentHost).where(inArray(agentHost.id, hostIds))
    },

    async listCapabilityGrantsForUser(userId) {
      const userAgents = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.userId, userId), eq(agent.status, 'active')))
      if (userAgents.length === 0) return []
      return db
        .select()
        .from(agentCapabilityGrant)
        .where(
          and(
            inArray(
              agentCapabilityGrant.agentId,
              userAgents.map((row) => row.id),
            ),
            eq(agentCapabilityGrant.status, 'active'),
          ),
        )
    },

    async listCapabilityGrantsForAgent(agentId) {
      return db.select().from(agentCapabilityGrant).where(eq(agentCapabilityGrant.agentId, agentId))
    },

    async decideApproval(input, audit) {
      const [request] = await db
        .select()
        .from(approvalRequest)
        .where(
          and(
            eq(approvalRequest.agentId, input.agentId),
            eq(approvalRequest.method, 'device_authorization'),
            eq(approvalRequest.status, 'pending'),
            eq(approvalRequest.userCodeHash, input.userCodeHash),
            gt(approvalRequest.expiresAt, input.now),
          ),
        )
        .limit(1)
      if (!request) throw badRequest('Agent approval is invalid, expired, or no longer pending.')

      const [[currentAgent], [host], pendingGrants] = await Promise.all([
        db.select().from(agent).where(eq(agent.id, input.agentId)).limit(1),
        request.hostId
          ? db.select().from(agentHost).where(eq(agentHost.id, request.hostId)).limit(1)
          : Promise.resolve([]),
        db
          .select()
          .from(agentCapabilityGrant)
          .where(and(eq(agentCapabilityGrant.agentId, input.agentId), eq(agentCapabilityGrant.status, 'pending'))),
      ])
      if (!currentAgent) throw notFound('Agent was not found.')
      if (currentAgent.userId && currentAgent.userId !== input.userId) {
        throw forbidden('Agent approval belongs to another controller.')
      }
      if (host?.userId && host.userId !== input.userId) {
        throw forbidden('Agent host belongs to another controller.')
      }

      const requestedCapabilities = input.capabilities ?? pendingGrants.map((grant) => grant.capability)
      if (requestedCapabilities.some((capability) => !pendingGrants.some((grant) => grant.capability === capability))) {
        throw badRequest('Agent approval includes a capability that is not pending.')
      }

      if (input.action === 'deny') {
        const statements = [
          db.insert(agentAuditEvent).select(
            db
              .select(agentAuditProjection(audit))
              .from(approvalRequest)
              .where(and(eq(approvalRequest.id, request.id), eq(approvalRequest.status, 'pending'))),
          ),
          db
            .update(approvalRequest)
            .set({ status: 'denied', updatedAt: input.now })
            .where(and(eq(approvalRequest.id, request.id), eq(approvalRequest.status, 'pending')))
            .returning({ id: approvalRequest.id }),
          ...(pendingGrants.length > 0
            ? [
                db
                  .update(agentCapabilityGrant)
                  .set({ status: 'denied', deniedBy: input.userId, updatedAt: input.now })
                  .where(
                    and(eq(agentCapabilityGrant.agentId, input.agentId), eq(agentCapabilityGrant.status, 'pending')),
                  ),
              ]
            : []),
          ...(currentAgent.status === 'pending'
            ? [
                db
                  .update(agent)
                  .set({ status: 'rejected', userId: input.userId, updatedAt: input.now })
                  .where(and(eq(agent.id, input.agentId), eq(agent.status, 'pending'))),
              ]
            : []),
        ] as const
        const results = await db.batch(statements)
        if (results[1].length === 0) throw badRequest('Agent approval is invalid, expired, or no longer pending.')
        return 'denied'
      }

      const approvedCapabilities = new Set(requestedCapabilities)
      const statements = [
        db.insert(agentAuditEvent).select(
          db
            .select(agentAuditProjection(audit))
            .from(approvalRequest)
            .where(and(eq(approvalRequest.id, request.id), eq(approvalRequest.status, 'pending'))),
        ),
        db
          .update(approvalRequest)
          .set({ status: 'approved', updatedAt: input.now })
          .where(and(eq(approvalRequest.id, request.id), eq(approvalRequest.status, 'pending')))
          .returning({ id: approvalRequest.id }),
        ...pendingGrants.map((grant) =>
          db
            .update(agentCapabilityGrant)
            .set(
              approvedCapabilities.has(grant.capability)
                ? { status: 'active', grantedBy: input.userId, updatedAt: input.now }
                : { status: 'denied', deniedBy: input.userId, updatedAt: input.now },
            )
            .where(and(eq(agentCapabilityGrant.id, grant.id), eq(agentCapabilityGrant.status, 'pending'))),
        ),
        ...(currentAgent.status === 'pending'
          ? [
              db
                .update(agent)
                .set({
                  status: 'active',
                  userId: input.userId,
                  activatedAt: input.now,
                  updatedAt: input.now,
                })
                .where(and(eq(agent.id, input.agentId), eq(agent.status, 'pending'))),
            ]
          : []),
        ...(host?.status === 'pending'
          ? [
              db
                .update(agentHost)
                .set({
                  status: 'active',
                  userId: input.userId,
                  activatedAt: input.now,
                  updatedAt: input.now,
                })
                .where(and(eq(agentHost.id, host.id), eq(agentHost.status, 'pending'))),
            ]
          : []),
      ] as const
      const results = await db.batch(statements)
      if (results[1].length === 0) throw badRequest('Agent approval is invalid, expired, or no longer pending.')
      return 'approved'
    },

    async revokeAgentForUser(agentId, userId) {
      const [current] = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.id, agentId), eq(agent.userId, userId)))
        .limit(1)
      if (!current) throw notFound('Agent was not found.')
      await revokeAgentRecord(db, agentId)
      await revokeAgentCapabilityGrants(db, agentId)
      await revokeAgentApprovalRequests(db, agentId)
    },

    async revokeCapabilityGrantForUser(grantId, userId) {
      const [grant] = await db
        .select({ agentId: agentCapabilityGrant.agentId })
        .from(agentCapabilityGrant)
        .where(eq(agentCapabilityGrant.id, grantId))
        .limit(1)
      if (!grant) throw notFound('Agent capability grant was not found.')
      const [current] = await db
        .select({ id: agent.id })
        .from(agent)
        .where(and(eq(agent.id, grant.agentId), eq(agent.userId, userId)))
        .limit(1)
      if (!current) throw notFound('Agent capability grant was not found.')
      await revokeCapabilityGrantRecord(db, grantId)
    },

    async revokeAgent(agentId) {
      const [current] = await db.select({ id: agent.id }).from(agent).where(eq(agent.id, agentId)).limit(1)
      if (!current) throw notFound('Agent was not found.')
      await revokeAgentRecord(db, agentId)
      await revokeAgentCapabilityGrants(db, agentId)
      await revokeAgentApprovalRequests(db, agentId)
    },

    async revokeHost(hostId) {
      const [current] = await db.select({ id: agentHost.id }).from(agentHost).where(eq(agentHost.id, hostId)).limit(1)
      if (!current) throw notFound('Agent host was not found.')
      const now = new Date()
      await db.update(agentHost).set({ status: 'revoked', updatedAt: now }).where(eq(agentHost.id, hostId))
      const hostAgents = await db.select({ id: agent.id }).from(agent).where(eq(agent.hostId, hostId))
      await Promise.all(hostAgents.map((row) => revokeAgentRecord(db, row.id)))
      await Promise.all(hostAgents.map((row) => revokeAgentCapabilityGrants(db, row.id)))
      await Promise.all(hostAgents.map((row) => revokeAgentApprovalRequests(db, row.id)))
      await revokeHostApprovalRequests(db, hostId)
    },

    async revokeCapabilityGrant(grantId) {
      const [current] = await db
        .select({ id: agentCapabilityGrant.id })
        .from(agentCapabilityGrant)
        .where(eq(agentCapabilityGrant.id, grantId))
        .limit(1)
      if (!current) throw notFound('Agent capability grant was not found.')
      await revokeCapabilityGrantRecord(db, grantId)
    },
  }
}

function agentAuditProjection(audit: Parameters<AgentRepository['decideApproval']>[1]) {
  return {
    id: sql<string>`${audit.id}`.as('id'),
    action: sql<string>`${audit.action}`.as('action'),
    result: sql<string>`${audit.result}`.as('result'),
    realmOwned: sql<boolean>`${audit.realmOwned}`.as('realm_owned'),
    ownerUserId: sql<string | null>`${audit.ownerUserId}`.as('owner_user_id'),
    ownerOrganizationId: sql<string | null>`${audit.ownerOrganizationId}`.as('owner_organization_id'),
    controllerUserId: sql<string | null>`${audit.controllerUserId}`.as('controller_user_id'),
    subjectIssuer: sql<string | null>`${audit.subjectIssuer}`.as('subject_issuer'),
    subject: sql<string | null>`${audit.subject}`.as('subject'),
    agentIdentityId: sql<string | null>`${audit.agentIdentityId}`.as('agent_identity_id'),
    hostId: sql<string | null>`${audit.hostId}`.as('host_id'),
    resourceId: sql<string | null>`${audit.resourceId}`.as('resource_id'),
    resourceConnectionId: sql<string | null>`${audit.resourceConnectionId}`.as('resource_connection_id'),
    accessGrantId: sql<string | null>`${audit.accessGrantId}`.as('access_grant_id'),
    scopes: sql<string[] | null>`${audit.scopes === null ? null : JSON.stringify(audit.scopes)}`.as('scopes'),
    reasonCode: sql<string | null>`${audit.reasonCode}`.as('reason_code'),
    metadata: sql<Record<string, unknown> | null>`${
      audit.metadata === null ? null : JSON.stringify(audit.metadata)
    }`.as('metadata'),
    occurredAt: sql<Date>`${audit.occurredAt.getTime()}`.as('occurred_at'),
  }
}

async function list<TTable extends { $inferSelect: unknown }>(
  db: Database,
  table: TTable,
  page: PaginationInput,
  orderBy: unknown,
  where?: unknown,
): Promise<PaginatedResult<TTable['$inferSelect']>> {
  const query = db.select().from(table as never)
  const rows = await (where ? query.where(where as never) : query)
    .orderBy(orderBy as never)
    .limit(page.limit)
    .offset(page.offset)
  const countQuery = db.select({ total: count() }).from(table as never)
  const [{ total }] = (await (where ? countQuery.where(where as never) : countQuery)) as unknown as [{ total: number }]

  return {
    items: rows as TTable['$inferSelect'][],
    total,
    ...page,
  }
}

async function revokeAgentRecord(db: Database, agentId: string) {
  await db.update(agent).set({ status: 'revoked', updatedAt: new Date() }).where(eq(agent.id, agentId))
}

async function revokeAgentCapabilityGrants(db: Database, agentId: string) {
  await db
    .update(agentCapabilityGrant)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(agentCapabilityGrant.agentId, agentId))
}

async function revokeCapabilityGrantRecord(db: Database, grantId: string) {
  await db
    .update(agentCapabilityGrant)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(agentCapabilityGrant.id, grantId))
}

async function revokeAgentApprovalRequests(db: Database, agentId: string) {
  await db
    .update(approvalRequest)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(approvalRequest.agentId, agentId))
}

async function revokeHostApprovalRequests(db: Database, hostId: string) {
  await db
    .update(approvalRequest)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(approvalRequest.hostId, hostId))
}
