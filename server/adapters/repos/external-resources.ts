import type { ExternalResourceRepository } from '@server/usecases/ports'
import { and, count, desc, eq, exists, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  agentAccessGrant,
  agentAccessRequest,
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
              ownerUserId: sql<string>`${input.ownerUserId}`.as('owner_user_id'),
              ownerOrganizationId: sql<string | null>`${input.ownerOrganizationId}`.as('owner_organization_id'),
              scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
              encryptedPkceVerifier: sql<string>`${input.encryptedPkceVerifier}`.as('encrypted_pkce_verifier'),
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

    async createAccessRequest(input) {
      const [row] = await db
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
      return row ?? null
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

    async listAccessRequestsByAgent(agentIdentityId, page) {
      const condition = eq(agentAccessRequest.agentIdentityId, agentIdentityId)
      const [items, totals] = await Promise.all([
        db
          .select()
          .from(agentAccessRequest)
          .where(condition)
          .orderBy(desc(agentAccessRequest.createdAt))
          .limit(page.limit)
          .offset(page.offset),
        db.select({ value: count() }).from(agentAccessRequest).where(condition),
      ])
      return { items, total: totals[0]?.value ?? 0, ...page }
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

    async listPendingAccessRequests() {
      return db
        .select()
        .from(agentAccessRequest)
        .where(eq(agentAccessRequest.status, 'pending'))
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
                  isNull(apiResource.archivedAt),
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
      const [row] = await db
        .insert(agentAccessGrant)
        .select(
          db
            .select({
              id: sql<string>`${input.id}`.as('id'),
              resourceId: apiResource.id,
              connectionId: sql<string | null>`${input.connectionId}`.as('connection_id'),
              agentIdentityId: sql<string>`${input.agentIdentityId}`.as('agent_identity_id'),
              scopes: sql<string[]>`${JSON.stringify(input.scopes)}`.as('scopes'),
              mode: sql<string>`${input.mode}`.as('mode'),
              status: sql<string>`${input.status}`.as('status'),
              grantedByUserId: sql<string>`${input.grantedByUserId}`.as('granted_by_user_id'),
              expiresAt: sql<Date | null>`${input.expiresAt?.getTime() ?? null}`.as('expires_at'),
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

    async summarizeAgentAccess(agentIdentityIds, now) {
      if (agentIdentityIds.length === 0) return new Map()
      const [requests, grants] = await Promise.all([
        db
          .select({ agentIdentityId: agentAccessRequest.agentIdentityId, value: count() })
          .from(agentAccessRequest)
          .where(
            and(
              inArray(agentAccessRequest.agentIdentityId, agentIdentityIds),
              eq(agentAccessRequest.status, 'pending'),
              gt(agentAccessRequest.expiresAt, now),
            ),
          )
          .groupBy(agentAccessRequest.agentIdentityId),
        db
          .select({ agentIdentityId: agentAccessGrant.agentIdentityId, value: count() })
          .from(agentAccessGrant)
          .where(
            and(
              inArray(agentAccessGrant.agentIdentityId, agentIdentityIds),
              eq(agentAccessGrant.status, 'active'),
              or(isNull(agentAccessGrant.expiresAt), gt(agentAccessGrant.expiresAt, now)),
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

    async consumeGrant(id, now) {
      const [row] = await db
        .update(agentAccessGrant)
        .set({ status: 'consumed', updatedAt: now })
        .where(and(eq(agentAccessGrant.id, id), eq(agentAccessGrant.status, 'active')))
        .returning({ id: agentAccessGrant.id })
      return Boolean(row)
    },

    async createTokenLease(input) {
      const [row] = await db
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
              expiresAt: sql<Date>`${input.expiresAt.getTime()}`.as('expires_at'),
              revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
              createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
            })
            .from(agentAccessGrant)
            .innerJoin(apiResource, eq(apiResource.id, agentAccessGrant.resourceId))
            .where(
              and(
                eq(agentAccessGrant.id, input.grantId),
                eq(agentAccessGrant.status, 'active'),
                eq(apiResource.enabled, true),
                isNull(apiResource.archivedAt),
              ),
            ),
        )
        .returning()
      return row ?? null
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
    return and(eq(apiResource.id, resourceId), eq(apiResource.enabled, true), isNull(apiResource.archivedAt))
  }
}
