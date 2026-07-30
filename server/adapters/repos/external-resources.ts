import type { ExternalResourceRepository } from '@server/usecases/ports'
import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  agentAccessGrant,
  agentAccessRequest,
  apiResource,
  externalResourceAuthorization,
  externalTokenLease,
  resourceAccountConnection,
  resourceConnectionIntent,
} from '../../db/schema'

export function createExternalResourceRepository(db: Database): ExternalResourceRepository {
  return {
    async createResourceWithAuthorization(resource, authorization) {
      const now = new Date()
      await db.batch([
        db.insert(apiResource).values({ ...resource, createdAt: now, updatedAt: now }),
        db.insert(externalResourceAuthorization).values(authorization),
      ])
    },

    async upsertAuthorization(input) {
      const [row] = await db
        .insert(externalResourceAuthorization)
        .values(input)
        .onConflictDoUpdate({
          target: externalResourceAuthorization.resourceId,
          set: {
            resourceUrl: input.resourceUrl,
            issuer: input.issuer,
            authorizationEndpoint: input.authorizationEndpoint,
            tokenEndpoint: input.tokenEndpoint,
            registrationEndpoint: input.registrationEndpoint,
            revocationEndpoint: input.revocationEndpoint,
            jwksUri: input.jwksUri,
            userInfoEndpoint: input.userInfoEndpoint,
            registrationMode: input.registrationMode,
            clientId: input.clientId,
            encryptedClientSecret: input.encryptedClientSecret,
            encryptedRegistrationAccessToken: input.encryptedRegistrationAccessToken,
            metadata: input.metadata,
            status: input.status,
            updatedAt: input.updatedAt,
          },
        })
        .returning()
      return row
    },

    async findAuthorization(resourceId) {
      const [row] = await db
        .select()
        .from(externalResourceAuthorization)
        .where(eq(externalResourceAuthorization.resourceId, resourceId))
        .limit(1)
      return row ?? null
    },

    async createConnection(input) {
      const [row] = await db.insert(resourceAccountConnection).values(input).returning()
      return row
    },

    async findConnectionByOwnerSubject(input) {
      const ownerCondition = input.ownerOrganizationId
        ? eq(resourceAccountConnection.ownerOrganizationId, input.ownerOrganizationId)
        : eq(resourceAccountConnection.ownerUserId, input.ownerUserId!)
      const [row] = await db
        .select()
        .from(resourceAccountConnection)
        .where(
          and(
            eq(resourceAccountConnection.resourceId, input.resourceId),
            eq(resourceAccountConnection.externalSubject, input.externalSubject),
            ownerCondition,
          ),
        )
        .limit(1)
      return row ?? null
    },

    async replaceConnectionAuthorization(id, input) {
      const [row] = await db
        .update(resourceAccountConnection)
        .set(input)
        .where(eq(resourceAccountConnection.id, id))
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
      const [row] = await db.insert(resourceConnectionIntent).values(input).returning()
      return row
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
      const [row] = await db.insert(agentAccessRequest).values(input).returning()
      return row
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
      const [row] = await db
        .update(agentAccessRequest)
        .set(input)
        .where(and(eq(agentAccessRequest.id, id), eq(agentAccessRequest.status, 'pending')))
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
      const [row] = await db.insert(agentAccessGrant).values(input).returning()
      return row
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
      const [row] = await db.insert(externalTokenLease).values(input).returning()
      return row
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
}
