import type {
  AgentAuditEventRecord,
  AgentAuthorityInventoryScope,
  ExternalResourceRepository,
} from '@server/usecases/ports'
import { and, count, desc, eq, exists, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  agentAccessGrant,
  agentAccessRequest,
  agentAuditEvent,
  agentConnectionRequest,
  agentIdentity,
  apiResource,
  externalTokenLease,
  resourceAccountConnection,
  resourceConnectionIntent,
} from '../../db/schema'

export function createExternalResourceRepository(db: Database): ExternalResourceRepository {
  return {
    async createConnection(input) {
      const [row] = await db
        .insert(resourceAccountConnection)
        .select(
          db
            .select({
              id: sql<string>`${input.id}`.as('id'),
              resourceId: apiResource.id,
              ownerUserId: sql<string | null>`${input.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${input.ownerOrganizationId}`.as('owner_organization_id'),
              externalSubject: sql<string>`${input.externalSubject}`.as('external_subject'),
              displayName: sql<string>`${input.displayName}`.as('display_name'),
              encryptedTokens: sql<string>`${input.encryptedTokens}`.as('encrypted_tokens'),
              grantedScopes: sql<string[]>`${JSON.stringify(input.grantedScopes)}`.as('granted_scopes'),
              authorizationDetails: sql<
                typeof input.authorizationDetails
              >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
              clientGeneration: sql<number>`${input.clientGeneration ?? 1}`.as('client_generation'),
              status: sql<string>`${input.status}`.as('status'),
              credentialExpiresAt: sql<Date | null>`${input.credentialExpiresAt?.getTime() ?? null}`.as(
                'credential_expires_at',
              ),
              revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
              createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
              updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
            })
            .from(apiResource)
            .where(activeResource(input.resourceId)),
        )
        .returning()
      return row ?? null
    },

    async findConnectionByOwnerResource(input) {
      const ownerCondition = input.ownerOrganizationId
        ? eq(resourceAccountConnection.ownerOrganizationId, input.ownerOrganizationId)
        : eq(resourceAccountConnection.ownerUserId, input.ownerUserId!)
      const [row] = await db
        .select()
        .from(resourceAccountConnection)
        .where(and(eq(resourceAccountConnection.resourceId, input.resourceId), ownerCondition))
        .limit(1)
      return row ?? null
    },

    async replaceConnectionAuthorization(id, resourceId, input) {
      const [row] = await db
        .update(resourceAccountConnection)
        .set(input)
        .where(
          and(
            eq(resourceAccountConnection.id, id),
            eq(resourceAccountConnection.resourceId, resourceId),
            exists(db.select({ id: apiResource.id }).from(apiResource).where(activeResource(resourceId))),
          ),
        )
        .returning()
      return row ?? null
    },

    async listConnectionsByUser(userId) {
      return db
        .select()
        .from(resourceAccountConnection)
        .where(eq(resourceAccountConnection.ownerUserId, userId))
        .orderBy(resourceAccountConnection.createdAt)
    },

    async listConnectionsByOrganizations(organizationIds) {
      if (organizationIds.length === 0) return []
      return db
        .select()
        .from(resourceAccountConnection)
        .where(inArray(resourceAccountConnection.ownerOrganizationId, organizationIds))
        .orderBy(resourceAccountConnection.createdAt)
    },

    async findConnection(id) {
      const [row] = await db
        .select()
        .from(resourceAccountConnection)
        .where(eq(resourceAccountConnection.id, id))
        .limit(1)
      return row ?? null
    },

    async updateConnectionTokens(id, input) {
      const [row] = await db
        .update(resourceAccountConnection)
        .set(input)
        .where(and(eq(resourceAccountConnection.id, id), eq(resourceAccountConnection.status, 'active')))
        .returning()
      return row ?? null
    },

    async revokeConnection(id, now) {
      const [row] = await db
        .update(resourceAccountConnection)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(resourceAccountConnection.id, id), eq(resourceAccountConnection.status, 'active')))
        .returning({ id: resourceAccountConnection.id })
      return Boolean(row)
    },

    async createConnectionIntent(input) {
      const [row] = await db
        .insert(resourceConnectionIntent)
        .select(
          db
            .select({
              id: sql<string>`${input.id}`.as('id'),
              stateHash: sql<string>`${input.stateHash}`.as('state_hash'),
              resourceId: apiResource.id,
              ownerUserId: sql<string | null>`${input.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${input.ownerOrganizationId}`.as('owner_organization_id'),
              initiatedByUserId: sql<string>`${input.initiatedByUserId}`.as('initiated_by_user_id'),
              scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
              authorizationDetails: sql<
                typeof input.authorizationDetails
              >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
              encryptedPkceVerifier: sql<string>`${input.encryptedPkceVerifier}`.as('encrypted_pkce_verifier'),
              clientGeneration: sql<number>`${input.clientGeneration ?? 1}`.as('client_generation'),
              returnTo: sql<string>`${input.returnTo}`.as('return_to'),
              status: sql<string>`${input.status}`.as('status'),
              expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as('expires_at'),
              completedAt: sql<Date | null>`${input.completedAt?.getTime() ?? null}`.as('completed_at'),
              createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
              updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
            })
            .from(apiResource)
            .where(activeResource(input.resourceId)),
        )
        .returning()
      return row ?? null
    },

    async consumeConnectionIntent(stateHash, now) {
      const [row] = await db
        .update(resourceConnectionIntent)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(resourceConnectionIntent.stateHash, stateHash),
            eq(resourceConnectionIntent.status, 'pending'),
            gt(resourceConnectionIntent.expiresAt, now),
          ),
        )
        .returning()
      return row ?? null
    },

    async createAgentConnectionRequest(input) {
      const [row] = await db
        .insert(agentConnectionRequest)
        .select(
          db
            .select({
              id: sql<string>`${input.id}`.as('id'),
              resourceId: apiResource.id,
              agentIdentityId: sql<string>`${input.agentIdentityId}`.as('agent_identity_id'),
              bindingId: sql<string>`${input.bindingId}`.as('binding_id'),
              scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
              authorizationDetails: sql<
                typeof input.authorizationDetails
              >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
              reason: sql<string | null>`${input.reason}`.as('reason'),
              approvalTokenHash: sql<string>`${input.approvalTokenHash}`.as('approval_token_hash'),
              encryptedApprovalToken: sql<string>`${input.encryptedApprovalToken}`.as('encrypted_approval_token'),
              expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as('expires_at'),
              createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
              updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
            })
            .from(apiResource)
            .where(activeResource(input.resourceId)),
        )
        .returning()
      return row ?? null
    },

    async findAgentConnectionRequest(id) {
      const [row] = await db.select().from(agentConnectionRequest).where(eq(agentConnectionRequest.id, id)).limit(1)
      return row ?? null
    },

    async findAgentConnectionRequestByApprovalTokenHash(tokenHash) {
      const [row] = await db
        .select()
        .from(agentConnectionRequest)
        .where(eq(agentConnectionRequest.approvalTokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    async createAccessRequest(input) {
      const [row] = await insertAccessRequest(input)
      return row ?? null
    },

    async createAccessRequestWithAudit(input, audit) {
      const [rows] = await db.batch([
        insertAccessRequest(input),
        db
          .insert(agentAuditEvent)
          .select(
            db.select(auditProjection(audit)).from(agentAccessRequest).where(eq(agentAccessRequest.id, input.id)),
          ),
      ])
      return rows[0] ?? null
    },

    async findAccessRequest(id) {
      const [row] = await db.select().from(agentAccessRequest).where(eq(agentAccessRequest.id, id)).limit(1)
      return row ?? null
    },

    async findAccessRequestByGrant(grantId) {
      const [row] = await db.select().from(agentAccessRequest).where(eq(agentAccessRequest.grantId, grantId)).limit(1)
      return row ?? null
    },

    async findAccessRequestByApprovalTokenHash(tokenHash) {
      const [row] = await db
        .select()
        .from(agentAccessRequest)
        .where(eq(agentAccessRequest.approvalTokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    async listAccessRequests(query, scope) {
      const now = new Date()
      const statusCondition =
        query.status === 'expired'
          ? and(eq(agentAccessRequest.status, 'pending'), lte(agentAccessRequest.expiresAt, now))
          : query.status === 'pending'
            ? and(eq(agentAccessRequest.status, 'pending'), gt(agentAccessRequest.expiresAt, now))
            : query.status
              ? eq(agentAccessRequest.status, query.status)
              : undefined
      const condition = and(
        query.agentId ? eq(agentAccessRequest.agentIdentityId, query.agentId) : undefined,
        query.resourceId ? eq(agentAccessRequest.resourceId, query.resourceId) : undefined,
        query.organizationId ? eq(agentIdentity.ownerOrganizationId, query.organizationId) : undefined,
        authorityOwnerCondition(scope),
        isNull(agentIdentity.deletedAt),
        isNull(apiResource.deletedAt),
        statusCondition,
      )
      const [items, totals] = await Promise.all([
        db
          .select({
            request: agentAccessRequest,
            resource: { id: apiResource.id, identifier: apiResource.identifier, name: apiResource.name },
          })
          .from(agentAccessRequest)
          .innerJoin(agentIdentity, eq(agentAccessRequest.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(agentAccessRequest.resourceId, apiResource.id))
          .where(condition)
          .orderBy(desc(agentAccessRequest.createdAt), desc(agentAccessRequest.id))
          .limit(query.limit)
          .offset(query.offset),
        db
          .select({ value: count() })
          .from(agentAccessRequest)
          .innerJoin(agentIdentity, eq(agentAccessRequest.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(agentAccessRequest.resourceId, apiResource.id))
          .where(condition),
      ])
      return { items, total: totals[0]?.value ?? 0, ...query }
    },

    async listPendingAccessRequestsByAgent(agentIdentityId, now) {
      return db
        .select()
        .from(agentAccessRequest)
        .where(
          and(
            eq(agentAccessRequest.agentIdentityId, agentIdentityId),
            eq(agentAccessRequest.status, 'pending'),
            gt(agentAccessRequest.expiresAt, now),
          ),
        )
        .orderBy(agentAccessRequest.createdAt)
    },

    async listPendingAccessRequests(now) {
      return db
        .select()
        .from(agentAccessRequest)
        .where(and(eq(agentAccessRequest.status, 'pending'), gt(agentAccessRequest.expiresAt, now)))
        .orderBy(agentAccessRequest.createdAt)
    },

    async decideAccessRequest(id, input) {
      const conditions = [eq(agentAccessRequest.id, id), eq(agentAccessRequest.status, 'pending')]
      if (input.status === 'approved' && input.grantId) {
        conditions.push(
          exists(
            db
              .select({ id: agentAccessGrant.id })
              .from(agentAccessGrant)
              .innerJoin(apiResource, eq(apiResource.id, agentAccessGrant.resourceId))
              .where(
                and(
                  eq(agentAccessGrant.id, input.grantId),
                  eq(agentAccessGrant.status, 'active'),
                  eq(apiResource.enabled, true),
                  isNull(apiResource.deletedAt),
                ),
              ),
          ),
        )
      }
      const [row] = await db
        .update(agentAccessRequest)
        .set(input)
        .where(and(...conditions))
        .returning()
      return row ?? null
    },

    async decideAccessRequestWithAudit(id, input, audit) {
      const [, rows] = await db.batch([
        db.insert(agentAuditEvent).select(
          db
            .select(auditProjection(audit))
            .from(agentAccessRequest)
            .where(and(eq(agentAccessRequest.id, id), eq(agentAccessRequest.status, 'pending'))),
        ),
        updateAccessRequestDecision(id, input),
      ])
      return rows[0] ?? null
    },

    async consumeAccessRequest(id, now) {
      const [row] = await db
        .update(agentAccessRequest)
        .set({ status: 'consumed', updatedAt: now })
        .where(and(eq(agentAccessRequest.id, id), eq(agentAccessRequest.status, 'approved')))
        .returning({ id: agentAccessRequest.id })
      return Boolean(row)
    },

    async listPendingAccessRequestsByConnections(connectionIds) {
      if (connectionIds.length === 0) return []
      return db
        .select()
        .from(agentAccessRequest)
        .where(and(inArray(agentAccessRequest.connectionId, connectionIds), eq(agentAccessRequest.status, 'pending')))
        .orderBy(agentAccessRequest.createdAt)
    },

    async createGrant(input) {
      const [row] = await insertGrant(input)
      return row ?? null
    },

    async approveAccessRequestWithAudit(grant, requestId, decision, audit) {
      const [grants, requests] = await db.batch([
        insertGrant(grant, requestId),
        updateAccessRequestDecision(requestId, decision),
        db
          .insert(agentAuditEvent)
          .select(db.select(auditProjection(audit)).from(agentAccessGrant).where(eq(agentAccessGrant.id, grant.id))),
      ])
      if (!grants[0]) return 'grant_unavailable'
      if (!requests[0]) return 'request_changed'
      return { grant: grants[0], request: requests[0] }
    },

    async findGrant(id) {
      const [row] = await db.select().from(agentAccessGrant).where(eq(agentAccessGrant.id, id)).limit(1)
      return row ?? null
    },

    async listActiveGrantsByAgent(agentIdentityId) {
      return db
        .select()
        .from(agentAccessGrant)
        .where(and(eq(agentAccessGrant.agentIdentityId, agentIdentityId), eq(agentAccessGrant.status, 'active')))
        .orderBy(agentAccessGrant.createdAt)
    },

    async listGrants(query, scope) {
      const now = new Date()
      const statusCondition =
        query.status === 'expired'
          ? and(eq(agentAccessGrant.status, 'active'), lte(agentAccessGrant.expiresAt, now))
          : query.status === 'active'
            ? and(
                eq(agentAccessGrant.status, 'active'),
                or(isNull(agentAccessGrant.expiresAt), gt(agentAccessGrant.expiresAt, now)),
              )
            : query.status
              ? eq(agentAccessGrant.status, query.status)
              : undefined
      const where = and(
        query.agentId ? eq(agentAccessGrant.agentIdentityId, query.agentId) : undefined,
        query.resourceId ? eq(agentAccessGrant.resourceId, query.resourceId) : undefined,
        query.organizationId ? eq(agentIdentity.ownerOrganizationId, query.organizationId) : undefined,
        authorityOwnerCondition(scope),
        ne(agentAccessGrant.status, 'revoked'),
        isNull(agentIdentity.deletedAt),
        isNull(apiResource.deletedAt),
        statusCondition,
      )
      const [items, totals] = await Promise.all([
        db
          .select({
            grant: agentAccessGrant,
            resource: { id: apiResource.id, identifier: apiResource.identifier, name: apiResource.name },
          })
          .from(agentAccessGrant)
          .innerJoin(agentIdentity, eq(agentAccessGrant.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(agentAccessGrant.resourceId, apiResource.id))
          .where(where)
          .orderBy(desc(agentAccessGrant.createdAt), desc(agentAccessGrant.id))
          .limit(query.limit)
          .offset(query.offset),
        db
          .select({ value: count() })
          .from(agentAccessGrant)
          .innerJoin(agentIdentity, eq(agentAccessGrant.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(agentAccessGrant.resourceId, apiResource.id))
          .where(where),
      ])
      return {
        items,
        total: totals[0]?.value ?? 0,
        limit: query.limit,
        offset: query.offset,
      }
    },

    async summarizeAgentAccess(agentIdentityIds, now) {
      if (agentIdentityIds.length === 0) return new Map()
      const [requests, grants] = await Promise.all([
        db
          .select({ agentIdentityId: agentAccessRequest.agentIdentityId, value: count() })
          .from(agentAccessRequest)
          .innerJoin(agentIdentity, eq(agentAccessRequest.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(agentAccessRequest.resourceId, apiResource.id))
          .where(
            and(
              inArray(agentAccessRequest.agentIdentityId, agentIdentityIds),
              eq(agentAccessRequest.status, 'pending'),
              gt(agentAccessRequest.expiresAt, now),
              isNull(agentIdentity.deletedAt),
              isNull(apiResource.deletedAt),
            ),
          )
          .groupBy(agentAccessRequest.agentIdentityId),
        db
          .select({ agentIdentityId: agentAccessGrant.agentIdentityId, value: count() })
          .from(agentAccessGrant)
          .innerJoin(agentIdentity, eq(agentAccessGrant.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(agentAccessGrant.resourceId, apiResource.id))
          .where(
            and(
              inArray(agentAccessGrant.agentIdentityId, agentIdentityIds),
              eq(agentAccessGrant.status, 'active'),
              or(isNull(agentAccessGrant.expiresAt), gt(agentAccessGrant.expiresAt, now)),
              isNull(agentIdentity.deletedAt),
              isNull(apiResource.deletedAt),
            ),
          )
          .groupBy(agentAccessGrant.agentIdentityId),
      ])
      const summaries = new Map(
        agentIdentityIds.map((agentIdentityId) => [agentIdentityId, { pendingRequestCount: 0, activeGrantCount: 0 }]),
      )
      for (const row of requests) summaries.get(row.agentIdentityId)!.pendingRequestCount = row.value
      for (const row of grants) summaries.get(row.agentIdentityId)!.activeGrantCount = row.value
      return summaries
    },

    async listActiveGrantsByConnection(connectionId) {
      return db
        .select()
        .from(agentAccessGrant)
        .where(and(eq(agentAccessGrant.connectionId, connectionId), eq(agentAccessGrant.status, 'active')))
        .orderBy(agentAccessGrant.createdAt)
    },

    async revokeGrant(id, now) {
      const [row] = await db
        .update(agentAccessGrant)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(agentAccessGrant.id, id), eq(agentAccessGrant.status, 'active')))
        .returning({ id: agentAccessGrant.id })
      return Boolean(row)
    },

    async revokeGrantWithAudit(id, tokenLeaseIds, now, audit) {
      const statements = [
        db.insert(agentAuditEvent).select(
          db
            .select(auditProjection(audit))
            .from(agentAccessGrant)
            .where(and(eq(agentAccessGrant.id, id), eq(agentAccessGrant.status, 'active'))),
        ),
        db
          .update(agentAccessGrant)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(and(eq(agentAccessGrant.id, id), eq(agentAccessGrant.status, 'active')))
          .returning({ id: agentAccessGrant.id }),
        ...(tokenLeaseIds.length > 0
          ? [
              db
                .update(externalTokenLease)
                .set({ revokedAt: now })
                .where(and(inArray(externalTokenLease.id, tokenLeaseIds), isNull(externalTokenLease.revokedAt))),
            ]
          : []),
      ] as const
      const results = await db.batch(statements)
      const grantResult = results[1]
      return Array.isArray(grantResult) && grantResult.length > 0
    },

    async consumeGrant(id, now) {
      const [row] = await db
        .update(agentAccessGrant)
        .set({ status: 'consumed', updatedAt: now })
        .where(and(eq(agentAccessGrant.id, id), eq(agentAccessGrant.status, 'active')))
        .returning({ id: agentAccessGrant.id })
      return Boolean(row)
    },

    async createTokenLease(input) {
      const [row] = await insertTokenLease(input)
      return row ?? null
    },

    async issueTokenLeaseWithAudit(input, consumeOneTimeGrant, now, audit) {
      const statements = [
        insertTokenLease(input),
        db
          .update(agentAccessRequest)
          .set({ status: 'consumed', updatedAt: now })
          .where(
            and(
              eq(agentAccessRequest.id, input.requestId),
              eq(agentAccessRequest.status, 'approved'),
              exists(
                db
                  .select({ id: externalTokenLease.id })
                  .from(externalTokenLease)
                  .where(eq(externalTokenLease.id, input.id)),
              ),
            ),
          ),
        ...(consumeOneTimeGrant
          ? [
              db
                .update(agentAccessGrant)
                .set({ status: 'consumed', updatedAt: now })
                .where(
                  and(
                    eq(agentAccessGrant.id, input.grantId),
                    eq(agentAccessGrant.status, 'active'),
                    exists(
                      db
                        .select({ id: externalTokenLease.id })
                        .from(externalTokenLease)
                        .where(eq(externalTokenLease.id, input.id)),
                    ),
                  ),
                ),
            ]
          : []),
        db
          .insert(agentAuditEvent)
          .select(
            db.select(auditProjection(audit)).from(externalTokenLease).where(eq(externalTokenLease.id, input.id)),
          ),
      ] as const
      const [leases] = await db.batch(statements)
      return leases[0] ?? null
    },

    async listActiveTokenLeasesByGrant(grantId, now) {
      return db
        .select()
        .from(externalTokenLease)
        .where(
          and(
            eq(externalTokenLease.grantId, grantId),
            gt(externalTokenLease.expiresAt, now),
            isNull(externalTokenLease.revokedAt),
          ),
        )
    },

    async listActiveTokenLeasesByBinding(bindingId, now) {
      return db
        .select()
        .from(externalTokenLease)
        .where(
          and(
            eq(externalTokenLease.bindingId, bindingId),
            gt(externalTokenLease.expiresAt, now),
            isNull(externalTokenLease.revokedAt),
          ),
        )
    },

    async revokeTokenLease(id, now) {
      const [row] = await db
        .update(externalTokenLease)
        .set({ revokedAt: now })
        .where(and(eq(externalTokenLease.id, id), gt(externalTokenLease.expiresAt, now)))
        .returning({ id: externalTokenLease.id })
      return Boolean(row)
    },
  }

  function activeResource(resourceId: string) {
    return and(eq(apiResource.id, resourceId), eq(apiResource.enabled, true), isNull(apiResource.deletedAt))
  }

  function insertAccessRequest(input: Parameters<ExternalResourceRepository['createAccessRequest']>[0]) {
    return db
      .insert(agentAccessRequest)
      .select(
        db
          .select({
            id: sql<string>`${input.id}`.as('id'),
            resourceId: apiResource.id,
            connectionId: sql<string | null>`${input.connectionId}`.as('connection_id'),
            agentIdentityId: sql<string>`${input.agentIdentityId}`.as('agent_identity_id'),
            bindingId: sql<string>`${input.bindingId}`.as('binding_id'),
            scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
            authorizationDetails: sql<
              typeof input.authorizationDetails
            >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
            reason: sql<string | null>`${input.reason}`.as('reason'),
            status: sql<string>`${input.status}`.as('status'),
            approvalTokenHash: sql<string>`${input.approvalTokenHash}`.as('approval_token_hash'),
            encryptedApprovalToken: sql<string>`${input.encryptedApprovalToken}`.as('encrypted_approval_token'),
            grantId: sql<string | null>`${input.grantId}`.as('grant_id'),
            expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as('expires_at'),
            decidedAt: sql<Date | null>`${input.decidedAt?.getTime() ?? null}`.as('decided_at'),
            createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
            updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
          })
          .from(apiResource)
          .where(activeResource(input.resourceId)),
      )
      .returning()
  }

  function updateAccessRequestDecision(
    id: string,
    input: Parameters<ExternalResourceRepository['decideAccessRequest']>[1],
  ) {
    const conditions = [eq(agentAccessRequest.id, id), eq(agentAccessRequest.status, 'pending')]
    if (input.status === 'approved' && input.grantId) {
      conditions.push(
        exists(
          db
            .select({ id: agentAccessGrant.id })
            .from(agentAccessGrant)
            .innerJoin(apiResource, eq(apiResource.id, agentAccessGrant.resourceId))
            .where(
              and(
                eq(agentAccessGrant.id, input.grantId),
                eq(agentAccessGrant.status, 'active'),
                eq(apiResource.enabled, true),
                isNull(apiResource.deletedAt),
              ),
            ),
        ),
      )
    }
    return db
      .update(agentAccessRequest)
      .set(input)
      .where(and(...conditions))
      .returning()
  }

  function insertGrant(input: Parameters<ExternalResourceRepository['createGrant']>[0], requestId?: string) {
    const source = requestId
      ? db
          .select({
            id: sql<string>`${input.id}`.as('id'),
            resourceId: apiResource.id,
            connectionId: sql<string | null>`${input.connectionId}`.as('connection_id'),
            agentIdentityId: sql<string>`${input.agentIdentityId}`.as('agent_identity_id'),
            scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
            authorizationDetails: sql<
              typeof input.authorizationDetails
            >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
            mode: sql<string>`${input.mode}`.as('mode'),
            status: sql<string>`${input.status}`.as('status'),
            grantedByUserId: sql<string>`${input.grantedByUserId}`.as('granted_by_user_id'),
            expiresAt: sql<Date | null>`${input.expiresAt?.getTime() ?? null}`.as('expires_at'),
            revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
            createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
            updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
          })
          .from(apiResource)
          .innerJoin(
            agentAccessRequest,
            and(
              eq(agentAccessRequest.id, requestId),
              eq(agentAccessRequest.resourceId, apiResource.id),
              eq(agentAccessRequest.status, 'pending'),
            ),
          )
          .where(activeResource(input.resourceId))
      : db
          .select({
            id: sql<string>`${input.id}`.as('id'),
            resourceId: apiResource.id,
            connectionId: sql<string | null>`${input.connectionId}`.as('connection_id'),
            agentIdentityId: sql<string>`${input.agentIdentityId}`.as('agent_identity_id'),
            scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
            authorizationDetails: sql<
              typeof input.authorizationDetails
            >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
            mode: sql<string>`${input.mode}`.as('mode'),
            status: sql<string>`${input.status}`.as('status'),
            grantedByUserId: sql<string>`${input.grantedByUserId}`.as('granted_by_user_id'),
            expiresAt: sql<Date | null>`${input.expiresAt?.getTime() ?? null}`.as('expires_at'),
            revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
            createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
            updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
          })
          .from(apiResource)
          .where(activeResource(input.resourceId))
    return db.insert(agentAccessGrant).select(source).returning()
  }

  function insertTokenLease(input: Parameters<ExternalResourceRepository['createTokenLease']>[0]) {
    return db
      .insert(externalTokenLease)
      .select(
        db
          .select({
            id: sql<string>`${input.id}`.as('id'),
            grantId: agentAccessGrant.id,
            requestId: sql<string>`${input.requestId}`.as('request_id'),
            bindingId: sql<string>`${input.bindingId}`.as('binding_id'),
            encryptedAccessToken: sql<string>`${input.encryptedAccessToken}`.as('encrypted_access_token'),
            tokenHash: sql<string>`${input.tokenHash}`.as('token_hash'),
            confirmationJkt: sql<string>`${input.confirmationJkt}`.as('confirmation_jkt'),
            scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
            authorizationDetails: sql<
              typeof input.authorizationDetails
            >`${JSON.stringify(input.authorizationDetails)}`.as('authorization_details'),
            expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as('expires_at'),
            revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
            createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
          })
          .from(agentAccessGrant)
          .innerJoin(apiResource, eq(apiResource.id, agentAccessGrant.resourceId))
          .innerJoin(
            agentAccessRequest,
            and(
              eq(agentAccessRequest.id, input.requestId),
              eq(agentAccessRequest.grantId, agentAccessGrant.id),
              eq(agentAccessRequest.status, 'approved'),
            ),
          )
          .where(
            and(
              eq(agentAccessGrant.id, input.grantId),
              eq(agentAccessGrant.status, 'active'),
              eq(apiResource.enabled, true),
              isNull(apiResource.deletedAt),
            ),
          ),
      )
      .returning()
  }

  function auditProjection(audit: AgentAuditEventRecord) {
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
      metadata: sql<Record<
        string,
        unknown
      > | null>`${audit.metadata === null ? null : JSON.stringify(audit.metadata)}`.as('metadata'),
      occurredAt: sql<Date>`${audit.occurredAt.getTime()}`.as('occurred_at'),
    }
  }
}

function authorityOwnerCondition(scope?: AgentAuthorityInventoryScope) {
  if (!scope) return undefined
  const owners = [
    scope.ownerUserId ? eq(agentIdentity.ownerUserId, scope.ownerUserId) : undefined,
    scope.ownerOrganizationIds?.length
      ? inArray(agentIdentity.ownerOrganizationId, scope.ownerOrganizationIds)
      : undefined,
  ].filter((condition) => condition !== undefined)
  return owners.length > 0 ? or(...owners) : sql`0`
}
