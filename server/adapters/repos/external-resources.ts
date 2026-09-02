import type {
  AgentAccessRequestRecord,
  AgentAuditEventRecord,
  AgentAuthorityInventoryScope,
  ExternalResourceRepository,
  ProviderConnectionRecord,
  ProviderResourceAuthorizationRecord,
  ResourceScopeEntitlementRecord,
  TokenLeaseAuthorizationBoundary,
} from '@server/usecases/ports'
import { and, count, desc, eq, exists, gt, inArray, isNotNull, isNull, lte, notExists, or, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  account,
  agentAccessRequest,
  agentAuditEvent,
  agentIdentity,
  apiResource,
  externalTokenLease,
  identityProviderConnector,
  providerConnection,
  providerCredential,
  providerResourceAuthorization,
  resourceConnectionIntent,
  resourceScopeEntitlement,
} from '../../db/schema'
import { scopeEntitlementStatusCondition } from './resource-scope-entitlement-filters'

export function createExternalResourceRepository(db: Database): ExternalResourceRepository {
  async function upsertProviderConnection(input: ProviderConnectionRecord) {
    const inserted = await db.insert(providerConnection).values(input).onConflictDoNothing().returning()
    if (inserted[0]) return inserted[0]
    const ownerCondition = input.ownerOrganizationId
      ? eq(providerConnection.ownerOrganizationId, input.ownerOrganizationId)
      : eq(providerConnection.ownerUserId, input.ownerUserId!)
    const [updated] = await db
      .update(providerConnection)
      .set({
        authenticationAccountId: input.authenticationAccountId,
        externalSubject: input.externalSubject,
        displayName: input.displayName,
        status: input.status,
        updatedAt: input.updatedAt,
      })
      .where(and(eq(providerConnection.connectorId, input.connectorId), ownerCondition))
      .returning()
    if (!updated) throw new Error('Provider Connection uniqueness invariant was violated.')
    return updated
  }

  async function findResourceAuthorization(id: string) {
    const [row] = await db
      .select({ authorization: providerResourceAuthorization, connection: providerConnection })
      .from(providerResourceAuthorization)
      .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
      .where(eq(providerResourceAuthorization.id, id))
      .limit(1)
    return row ? toProviderResourceAuthorization(db, row.authorization, row.connection) : null
  }

  return {
    upsertProviderConnection,

    async findProviderConnectionByOwnerConnector(input) {
      const ownerCondition = input.ownerOrganizationId
        ? eq(providerConnection.ownerOrganizationId, input.ownerOrganizationId)
        : eq(providerConnection.ownerUserId, input.ownerUserId!)
      const [row] = await db
        .select()
        .from(providerConnection)
        .where(and(eq(providerConnection.connectorId, input.connectorId), ownerCondition))
        .limit(1)
      return row ?? null
    },

    async findActiveUserProviderConnectionByProviderSubject(input) {
      const [row] = await db
        .select({ connection: providerConnection })
        .from(providerConnection)
        .innerJoin(identityProviderConnector, eq(identityProviderConnector.id, providerConnection.connectorId))
        .where(
          and(
            eq(identityProviderConnector.providerId, input.providerId),
            eq(providerConnection.externalSubject, input.externalSubject),
            eq(providerConnection.status, 'active'),
            isNotNull(providerConnection.ownerUserId),
          ),
        )
        .limit(1)
      return row?.connection ?? null
    },

    async findProviderConnection(id) {
      const [row] = await db.select().from(providerConnection).where(eq(providerConnection.id, id)).limit(1)
      return row ?? null
    },

    async listProviderConnectionsByUser(userId) {
      const rows = await db
        .select({ connection: providerConnection, connector: identityProviderConnector })
        .from(providerConnection)
        .innerJoin(identityProviderConnector, eq(identityProviderConnector.id, providerConnection.connectorId))
        .where(and(eq(providerConnection.ownerUserId, userId), eq(providerConnection.status, 'active')))
        .orderBy(providerConnection.createdAt)
      if (rows.length === 0) return []
      const authorizations = await db
        .select({
          providerConnectionId: providerResourceAuthorization.providerConnectionId,
          resourceName: apiResource.name,
        })
        .from(providerResourceAuthorization)
        .innerJoin(apiResource, eq(apiResource.id, providerResourceAuthorization.resourceId))
        .where(
          and(
            inArray(
              providerResourceAuthorization.providerConnectionId,
              rows.map(({ connection }) => connection.id),
            ),
            eq(providerResourceAuthorization.status, 'active'),
          ),
        )
      return rows.map(({ connection, connector }) => {
        const resources = authorizations.filter((authorization) => authorization.providerConnectionId === connection.id)
        return {
          ...connection,
          connector: {
            id: connector.id,
            slug: connector.slug,
            providerType: connector.providerType,
            providerId: connector.providerId,
            displayName: connector.displayName,
            enabled: connector.enabled,
            authenticationEnabled: connector.authenticationEnabled,
            resourceAuthorizationEnabled: connector.resourceAuthorizationEnabled,
          },
          resourceAuthorizationCount: resources.length,
          resourceNames: resources.map(({ resourceName }) => resourceName),
        }
      })
    },

    async revokeProviderConnection(id, ownerUserId, now) {
      const [connection] = await db
        .select({ id: providerConnection.id, authenticationAccountId: providerConnection.authenticationAccountId })
        .from(providerConnection)
        .where(and(eq(providerConnection.id, id), eq(providerConnection.ownerUserId, ownerUserId)))
        .limit(1)
      if (!connection) return false
      const revokeConnection = db
        .update(providerConnection)
        .set({ authenticationAccountId: null, status: 'revoked', updatedAt: now })
        .where(and(eq(providerConnection.id, id), eq(providerConnection.ownerUserId, ownerUserId)))
      if (connection.authenticationAccountId) {
        await db.batch([revokeConnection, db.delete(account).where(eq(account.id, connection.authenticationAccountId))])
      } else {
        await revokeConnection
      }
      return true
    },

    async createResourceAuthorization(input) {
      const authorizationInsert = db.insert(providerResourceAuthorization).select(
        db
          .select({
            id: sql<string>`${input.id}`.as('id'),
            providerConnectionId: sql<string>`${input.providerConnectionId}`.as('provider_connection_id'),
            resourceId: apiResource.id,
            status: sql<string>`${input.status}`.as('status'),
            revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
            createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
            updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
          })
          .from(apiResource)
          .where(activeResource(input.resourceId)),
      )
      await db.batch([authorizationInsert, db.insert(providerCredential).values(input.credentials)])
      return findResourceAuthorization(input.id)
    },

    async findConnectionByOwnerResource(input) {
      const ownerCondition = input.ownerOrganizationId
        ? eq(providerConnection.ownerOrganizationId, input.ownerOrganizationId)
        : eq(providerConnection.ownerUserId, input.ownerUserId!)
      const [row] = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(and(eq(providerResourceAuthorization.resourceId, input.resourceId), ownerCondition))
        .limit(1)
      return row ? toProviderResourceAuthorization(db, row.authorization, row.connection) : null
    },

    async findConnectionByProviderResource(input) {
      const [row] = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(
          and(
            eq(providerResourceAuthorization.providerConnectionId, input.providerConnectionId),
            eq(providerResourceAuthorization.resourceId, input.resourceId),
          ),
        )
        .limit(1)
      return row ? toProviderResourceAuthorization(db, row.authorization, row.connection) : null
    },

    async upsertProviderCredential(providerResourceAuthorizationId, input) {
      const [authorization] = await db
        .select({ id: providerResourceAuthorization.id })
        .from(providerResourceAuthorization)
        .innerJoin(apiResource, eq(apiResource.id, providerResourceAuthorization.resourceId))
        .where(
          and(
            eq(providerResourceAuthorization.id, providerResourceAuthorizationId),
            eq(apiResource.enabled, true),
            isNull(apiResource.deletedAt),
          ),
        )
        .limit(1)
      if (!authorization) return null
      await db.batch([
        db
          .update(providerResourceAuthorization)
          .set({
            status: 'active',
            revokedAt: null,
            updatedAt: input.updatedAt,
          })
          .where(eq(providerResourceAuthorization.id, providerResourceAuthorizationId)),
        db
          .insert(providerCredential)
          .values({ ...input, providerResourceAuthorizationId })
          .onConflictDoUpdate({
            target: providerCredential.providerResourceAuthorizationId,
            set: {
              encryptedTokens: input.encryptedTokens,
              grantedScopes: input.grantedScopes,
              authorizationDetails: input.authorizationDetails,
              clientGeneration: input.clientGeneration,
              credentialVersion: input.credentialVersion,
              refreshClaimId: null,
              refreshClaimExpiresAt: null,
              status: 'active',
              credentialExpiresAt: input.credentialExpiresAt,
              revokedAt: null,
              updatedAt: input.updatedAt,
            },
          }),
      ])
      return findResourceAuthorization(providerResourceAuthorizationId)
    },

    async listConnectionsByUser(userId) {
      const rows = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(eq(providerConnection.ownerUserId, userId))
        .orderBy(providerResourceAuthorization.createdAt)
      return Promise.all(rows.map((row) => toProviderResourceAuthorization(db, row.authorization, row.connection)))
    },

    async listConnectionsByOrganizations(organizationIds) {
      if (organizationIds.length === 0) return []
      const rows = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(inArray(providerConnection.ownerOrganizationId, organizationIds))
        .orderBy(providerResourceAuthorization.createdAt)
      return Promise.all(rows.map((row) => toProviderResourceAuthorization(db, row.authorization, row.connection)))
    },

    async findConnection(id) {
      return findResourceAuthorization(id)
    },

    async updateProviderCredentialTokens(id, input) {
      const [row] = await db
        .update(providerCredential)
        .set(input)
        .where(and(eq(providerCredential.id, id), eq(providerCredential.status, 'active')))
        .returning()
      return row ?? null
    },

    async claimProviderCredentialRefresh(input) {
      const [row] = await db
        .update(providerCredential)
        .set({ refreshClaimId: input.claimId, refreshClaimExpiresAt: input.claimExpiresAt, updatedAt: input.now })
        .where(
          and(
            eq(providerCredential.id, input.id),
            eq(providerCredential.status, 'active'),
            eq(providerCredential.credentialVersion, input.expectedVersion),
            or(
              isNull(providerCredential.refreshClaimId),
              isNull(providerCredential.refreshClaimExpiresAt),
              lte(providerCredential.refreshClaimExpiresAt, input.now),
            ),
          ),
        )
        .returning({ id: providerCredential.id })
      return Boolean(row)
    },

    async completeProviderCredentialRefresh(id, input) {
      const [row] = await db
        .update(providerCredential)
        .set({
          encryptedTokens: input.encryptedTokens,
          credentialExpiresAt: input.credentialExpiresAt,
          credentialVersion: input.expectedVersion + 1,
          refreshClaimId: null,
          refreshClaimExpiresAt: null,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(providerCredential.id, id),
            eq(providerCredential.status, 'active'),
            eq(providerCredential.credentialVersion, input.expectedVersion),
            eq(providerCredential.refreshClaimId, input.claimId),
          ),
        )
        .returning()
      return row ?? null
    },

    async releaseProviderCredentialRefresh(id, expectedVersion, claimId, now) {
      const [row] = await db
        .update(providerCredential)
        .set({ refreshClaimId: null, refreshClaimExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(providerCredential.id, id),
            eq(providerCredential.status, 'active'),
            eq(providerCredential.credentialVersion, expectedVersion),
            eq(providerCredential.refreshClaimId, claimId),
          ),
        )
        .returning({ id: providerCredential.id })
      return Boolean(row)
    },

    async revokeProviderCredential(id, now) {
      const [credential] = await db
        .update(providerCredential)
        .set({
          status: 'revoked',
          revokedAt: now,
          refreshClaimId: null,
          refreshClaimExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(providerCredential.id, id), eq(providerCredential.status, 'active')))
        .returning({ providerResourceAuthorizationId: providerCredential.providerResourceAuthorizationId })
      if (!credential) return false
      await db
        .update(providerResourceAuthorization)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(providerResourceAuthorization.id, credential.providerResourceAuthorizationId),
            notExists(
              db
                .select({ id: providerCredential.id })
                .from(providerCredential)
                .where(
                  and(
                    eq(providerCredential.providerResourceAuthorizationId, credential.providerResourceAuthorizationId),
                    eq(providerCredential.status, 'active'),
                  ),
                ),
            ),
          ),
        )
      return true
    },

    async revokeConnection(id, now) {
      const [row] = await db
        .select({ id: providerResourceAuthorization.id })
        .from(providerResourceAuthorization)
        .where(and(eq(providerResourceAuthorization.id, id), eq(providerResourceAuthorization.status, 'active')))
        .limit(1)
      if (!row) return false
      await db.batch([
        db
          .update(providerResourceAuthorization)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(eq(providerResourceAuthorization.id, id)),
        db
          .update(providerCredential)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(eq(providerCredential.providerResourceAuthorizationId, id)),
      ])
      return true
    },

    async revokeResourceAuthorizationsByConnector(connectorId, now) {
      const authorizations = await db
        .select({ id: providerResourceAuthorization.id })
        .from(providerResourceAuthorization)
        .innerJoin(apiResource, eq(apiResource.id, providerResourceAuthorization.resourceId))
        .where(and(eq(apiResource.connectorId, connectorId), eq(providerResourceAuthorization.status, 'active')))
      if (authorizations.length === 0) return 0
      const authorizationIds = authorizations.map(({ id }) => id)
      await db.batch([
        db
          .update(agentAccessRequest)
          .set({ connectionId: null, updatedAt: now })
          .where(inArray(agentAccessRequest.connectionId, authorizationIds)),
        db
          .update(resourceScopeEntitlement)
          .set({ connectionId: null, updatedAt: now })
          .where(inArray(resourceScopeEntitlement.connectionId, authorizationIds)),
        db
          .update(providerCredential)
          .set({
            status: 'revoked',
            revokedAt: now,
            refreshClaimId: null,
            refreshClaimExpiresAt: null,
            updatedAt: now,
          })
          .where(inArray(providerCredential.providerResourceAuthorizationId, authorizationIds)),
        db
          .update(providerResourceAuthorization)
          .set({ status: 'revoked', revokedAt: now, updatedAt: now })
          .where(inArray(providerResourceAuthorization.id, authorizationIds)),
      ])
      return authorizationIds.length
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

    async listPendingAccessRequests(now) {
      return db
        .select()
        .from(agentAccessRequest)
        .where(and(eq(agentAccessRequest.status, 'pending'), gt(agentAccessRequest.expiresAt, now)))
        .orderBy(agentAccessRequest.createdAt)
    },

    async decideAccessRequest(id, input) {
      const conditions = [eq(agentAccessRequest.id, id), eq(agentAccessRequest.status, 'pending')]
      if (input.status === 'approved' && input.approvedEntitlements.length > 0) {
        conditions.push(
          exists(
            db
              .select({ id: apiResource.id })
              .from(apiResource)
              .where(
                and(
                  eq(apiResource.id, agentAccessRequest.resourceId),
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

    async approveAccessRequestWithEntitlements(entitlements, entitlementUpdates, requestId, decision, audit) {
      const statements = [
        ...entitlements.map((entitlement) => insertEntitlement(entitlement, requestId)),
        ...entitlementUpdates.map((update) =>
          db
            .update(resourceScopeEntitlement)
            .set({
              mode: update.mode,
              expiresAt: update.expiresAt,
              authorizationContextHash: update.authorizationContextHash,
              updatedAt: update.updatedAt,
            })
            .where(and(eq(resourceScopeEntitlement.id, update.id), isNull(resourceScopeEntitlement.endedAt)))
            .returning(),
        ),
        updateAccessRequestDecision(requestId, decision),
        db.insert(agentAuditEvent).select(
          db
            .select(auditProjection(audit))
            .from(agentAccessRequest)
            .where(and(eq(agentAccessRequest.id, requestId), eq(agentAccessRequest.status, 'approved'))),
        ),
      ] as const
      const results = await db.batch(
        statements as unknown as [(typeof statements)[number], ...Array<(typeof statements)[number]>],
      )
      const requestRows = results[entitlements.length + entitlementUpdates.length] as AgentAccessRequestRecord[]
      const inserted = results.slice(0, entitlements.length).flat() as ResourceScopeEntitlementRecord[]
      if (inserted.length !== entitlements.length) return 'entitlements_changed'
      const updated = results.slice(entitlements.length, entitlements.length + entitlementUpdates.length)
      if (updated.some((rows) => !Array.isArray(rows) || rows.length !== 1)) return 'resource_unavailable'
      if (!requestRows[0]) return 'request_changed'
      return { entitlements: inserted, request: requestRows[0] }
    },

    async findEntitlement(id) {
      const [row] = await db.select().from(resourceScopeEntitlement).where(eq(resourceScopeEntitlement.id, id)).limit(1)
      return row ?? null
    },

    async findEntitlements(ids) {
      if (ids.length === 0) return []
      return db.select().from(resourceScopeEntitlement).where(inArray(resourceScopeEntitlement.id, ids))
    },

    async listActiveEntitlementsByAgent(agentIdentityId, now) {
      return db
        .select()
        .from(resourceScopeEntitlement)
        .where(
          and(
            eq(resourceScopeEntitlement.agentIdentityId, agentIdentityId),
            isNull(resourceScopeEntitlement.endedAt),
            or(isNull(resourceScopeEntitlement.expiresAt), gt(resourceScopeEntitlement.expiresAt, now)),
          ),
        )
        .orderBy(resourceScopeEntitlement.createdAt)
    },

    async listAgentPermissions(query, scope) {
      const now = new Date()
      const statusCondition = scopeEntitlementStatusCondition(query.status, now)
      const where = and(
        query.agentId ? eq(resourceScopeEntitlement.agentIdentityId, query.agentId) : undefined,
        query.resourceServerId ? eq(resourceScopeEntitlement.resourceServerId, query.resourceServerId) : undefined,
        query.organizationId ? eq(agentIdentity.ownerOrganizationId, query.organizationId) : undefined,
        authorityOwnerCondition(scope),
        isNull(agentIdentity.deletedAt),
        isNull(apiResource.deletedAt),
        statusCondition,
      )
      const [items, totals] = await Promise.all([
        db
          .select({
            entitlement: resourceScopeEntitlement,
            resource: { id: apiResource.id, identifier: apiResource.identifier, name: apiResource.name },
          })
          .from(resourceScopeEntitlement)
          .innerJoin(agentIdentity, eq(resourceScopeEntitlement.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(resourceScopeEntitlement.resourceServerId, apiResource.id))
          .where(where)
          .orderBy(desc(resourceScopeEntitlement.createdAt), desc(resourceScopeEntitlement.id))
          .limit(query.limit)
          .offset(query.offset),
        db
          .select({ value: count() })
          .from(resourceScopeEntitlement)
          .innerJoin(agentIdentity, eq(resourceScopeEntitlement.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(resourceScopeEntitlement.resourceServerId, apiResource.id))
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
      const [requests, entitlements] = await Promise.all([
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
          .select({
            agentIdentityId: resourceScopeEntitlement.agentIdentityId,
            scopes: count(),
            resources: sql<number>`count(distinct ${resourceScopeEntitlement.resourceServerId})`,
          })
          .from(resourceScopeEntitlement)
          .innerJoin(agentIdentity, eq(resourceScopeEntitlement.agentIdentityId, agentIdentity.id))
          .innerJoin(apiResource, eq(resourceScopeEntitlement.resourceServerId, apiResource.id))
          .where(
            and(
              inArray(resourceScopeEntitlement.agentIdentityId, agentIdentityIds),
              isNull(resourceScopeEntitlement.endedAt),
              or(isNull(resourceScopeEntitlement.expiresAt), gt(resourceScopeEntitlement.expiresAt, now)),
              isNull(agentIdentity.deletedAt),
              isNull(apiResource.deletedAt),
            ),
          )
          .groupBy(resourceScopeEntitlement.agentIdentityId),
      ])
      const summaries = new Map(
        agentIdentityIds.map((agentIdentityId) => [
          agentIdentityId,
          { pendingRequestCount: 0, activeResourceCount: 0, activeScopeCount: 0 },
        ]),
      )
      for (const row of requests) summaries.get(row.agentIdentityId)!.pendingRequestCount = row.value
      for (const row of entitlements) {
        const summary = summaries.get(row.agentIdentityId!)!
        summary.activeScopeCount = row.scopes
        summary.activeResourceCount = row.resources
      }
      return summaries
    },

    async listActiveEntitlementsByConnection(connectionId, now) {
      return db
        .select()
        .from(resourceScopeEntitlement)
        .where(
          and(
            eq(resourceScopeEntitlement.connectionId, connectionId),
            isNull(resourceScopeEntitlement.endedAt),
            or(isNull(resourceScopeEntitlement.expiresAt), gt(resourceScopeEntitlement.expiresAt, now)),
          ),
        )
        .orderBy(resourceScopeEntitlement.createdAt)
    },

    async endEntitlement(id, reason, now) {
      const [row] = await db
        .update(resourceScopeEntitlement)
        .set({ endedAt: now, endReason: reason, updatedAt: now })
        .where(and(eq(resourceScopeEntitlement.id, id), isNull(resourceScopeEntitlement.endedAt)))
        .returning({ id: resourceScopeEntitlement.id })
      return Boolean(row)
    },

    async endEntitlementWithAudit(id, reason, tokenLeaseIds, now, audit) {
      const statements = [
        db.insert(agentAuditEvent).select(
          db
            .select(auditProjection(audit))
            .from(resourceScopeEntitlement)
            .where(and(eq(resourceScopeEntitlement.id, id), isNull(resourceScopeEntitlement.endedAt))),
        ),
        db
          .update(resourceScopeEntitlement)
          .set({ endedAt: now, endReason: reason, updatedAt: now })
          .where(and(eq(resourceScopeEntitlement.id, id), isNull(resourceScopeEntitlement.endedAt)))
          .returning({ id: resourceScopeEntitlement.id }),
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
      const entitlementResult = results[1]
      return Array.isArray(entitlementResult) && entitlementResult.length > 0
    },

    async createTokenLease(input) {
      const [row] = await insertTokenLease(input)
      return row ?? null
    },

    async issueTokenLeaseWithAudit(input, boundary, consumeEntitlementIds, now, audit) {
      const statements = [
        insertTokenLease(input, boundary),
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
        ...(consumeEntitlementIds.length > 0
          ? [
              db
                .update(resourceScopeEntitlement)
                .set({ endedAt: now, endReason: 'consumed', updatedAt: now })
                .where(
                  and(
                    inArray(resourceScopeEntitlement.id, consumeEntitlementIds),
                    isNull(resourceScopeEntitlement.endedAt),
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

    async listActiveTokenLeasesByEntitlement(entitlementId, now) {
      return db
        .select()
        .from(externalTokenLease)
        .where(
          and(
            sql`exists (
              select 1 from json_each(${externalTokenLease.entitlementIds}) as lease_entitlement
              where lease_entitlement.value = ${entitlementId}
            )`,
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

    async findActiveTokenLeaseByTokenHash(tokenHash, now) {
      const [row] = await db
        .select()
        .from(externalTokenLease)
        .where(
          and(
            eq(externalTokenLease.tokenHash, tokenHash),
            gt(externalTokenLease.expiresAt, now),
            isNull(externalTokenLease.revokedAt),
          ),
        )
        .limit(1)
      return row ?? null
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
            approvedEntitlements: sql<
              typeof input.approvedEntitlements
            >`${JSON.stringify(input.approvedEntitlements)}`.as('approved_entitlements'),
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
    if (input.status === 'approved') {
      conditions.push(
        exists(
          db
            .select({ id: apiResource.id })
            .from(apiResource)
            .where(
              and(
                eq(apiResource.id, agentAccessRequest.resourceId),
                eq(apiResource.enabled, true),
                isNull(apiResource.deletedAt),
              ),
            ),
        ),
        sql`json_array_length(${JSON.stringify(input.approvedEntitlements)}) = json_array_length(${agentAccessRequest.scopes})`,
        sql`not exists (
          select 1 from json_each(${JSON.stringify(input.approvedEntitlements)}) as approved
          left join resource_scope_entitlement as entitlement
            on entitlement.id = json_extract(approved.value, '$.entitlementId')
          where entitlement.id is null
            or entitlement.agent_identity_id <> ${agentAccessRequest.agentIdentityId}
            or entitlement.resource_server_id <> ${agentAccessRequest.resourceId}
            or entitlement.connection_id is not ${input.connectionId ?? null}
            or entitlement.scope <> json_extract(approved.value, '$.scope')
            or entitlement.ended_at is not null
        )`,
      )
    }
    return db
      .update(agentAccessRequest)
      .set(input)
      .where(and(...conditions))
      .returning()
  }

  function insertEntitlement(input: ResourceScopeEntitlementRecord, requestId: string) {
    const activeConnection = input.connectionId
      ? exists(
          db
            .select({ id: providerResourceAuthorization.id })
            .from(providerResourceAuthorization)
            .where(
              and(
                eq(providerResourceAuthorization.id, input.connectionId),
                eq(providerResourceAuthorization.status, 'active'),
              ),
            ),
        )
      : undefined
    const source = db
      .select({
        id: sql<string>`${input.id}`.as('id'),
        userId: sql<string | null>`null`.as('user_id'),
        applicationId: sql<string | null>`null`.as('application_id'),
        agentIdentityId: sql<string | null>`${input.agentIdentityId}`.as('agent_identity_id'),
        organizationId: sql<string | null>`null`.as('organization_id'),
        resourceServerId: apiResource.id,
        connectionId: sql<string | null>`${input.connectionId}`.as('connection_id'),
        authorizationDetails: sql<typeof input.authorizationDetails>`${JSON.stringify(input.authorizationDetails)}`.as(
          'authorization_details',
        ),
        authorizationContextHash: sql<string>`${input.authorizationContextHash}`.as('authorization_context_hash'),
        scope: sql<string>`${input.scope}`.as('scope'),
        mode: sql<string>`${input.mode}`.as('mode'),
        grantedByUserId: sql<string | null>`${input.grantedByUserId}`.as('granted_by_user_id'),
        grantedByAgentIdentityId: sql<string | null>`${input.grantedByAgentIdentityId}`.as(
          'granted_by_agent_identity_id',
        ),
        sourceAccessRequestId: agentAccessRequest.id,
        expiresAt: sql<Date | null>`${input.expiresAt?.getTime() ?? null}`.as('expires_at'),
        endedAt: sql<Date | null>`null`.as('ended_at'),
        endReason: sql<string | null>`null`.as('end_reason'),
        createdAt: sql<Date>`${input.createdAt.getTime()}`.as('created_at'),
        updatedAt: sql<Date>`${input.updatedAt.getTime()}`.as('updated_at'),
      })
      .from(apiResource)
      .innerJoin(
        agentAccessRequest,
        and(
          eq(agentAccessRequest.id, requestId),
          eq(agentAccessRequest.resourceId, apiResource.id),
          eq(agentAccessRequest.agentIdentityId, input.agentIdentityId!),
          eq(agentAccessRequest.status, 'pending'),
        ),
      )
      .where(and(activeResource(input.resourceServerId), activeConnection))
    return db.insert(resourceScopeEntitlement).select(source).onConflictDoNothing().returning()
  }

  function insertTokenLease(
    input: Parameters<ExternalResourceRepository['createTokenLease']>[0],
    boundary?: TokenLeaseAuthorizationBoundary,
  ) {
    const entitlementConditions = boundary
      ? [
          eq(agentAccessRequest.agentIdentityId, boundary.agentIdentityId),
          eq(agentAccessRequest.resourceId, boundary.resourceServerId),
          sql`${agentAccessRequest.connectionId} is ${boundary.connectionId}`,
          sql`json_array_length(${JSON.stringify(input.entitlementIds)}) = json_array_length(${JSON.stringify(boundary.scopes)})`,
          sql`not exists (
            select 1 from json_each(${JSON.stringify(input.entitlementIds)}) as supplied
            left join resource_scope_entitlement as entitlement on entitlement.id = supplied.value
            where entitlement.id is null
              or entitlement.agent_identity_id <> ${boundary.agentIdentityId}
              or entitlement.resource_server_id <> ${boundary.resourceServerId}
              or entitlement.connection_id is not ${boundary.connectionId}
              or entitlement.authorization_context_hash <> ${boundary.authorizationContextHash}
              or entitlement.ended_at is not null
              or (entitlement.expires_at is not null and entitlement.expires_at <= ${input.createdAt.getTime()})
              or not exists (
                select 1 from json_each(${JSON.stringify(boundary.scopes)}) as requested
                where requested.value = entitlement.scope
              )
          )`,
          sql`not exists (
            select 1 from json_each(${JSON.stringify(boundary.scopes)}) as requested
            where not exists (
              select 1 from json_each(${JSON.stringify(input.entitlementIds)}) as supplied
              join resource_scope_entitlement as entitlement on entitlement.id = supplied.value
              where entitlement.scope = requested.value
            )
          )`,
        ]
      : [
          sql`json_array_length(${agentAccessRequest.approvedEntitlements}) > 0`,
          sql`not exists (
            select 1 from json_each(${agentAccessRequest.approvedEntitlements}) as approved
            left join resource_scope_entitlement as entitlement
              on entitlement.id = json_extract(approved.value, '$.entitlementId')
            where entitlement.id is null
              or entitlement.ended_at is not null
              or (entitlement.expires_at is not null and entitlement.expires_at <= ${input.createdAt.getTime()})
              or not exists (
                select 1 from json_each(${JSON.stringify(input.entitlementIds)}) as supplied
                where supplied.value = entitlement.id
              )
          )`,
          sql`not exists (
            select 1 from json_each(${JSON.stringify(input.entitlementIds)}) as supplied
            where not exists (
              select 1 from json_each(${agentAccessRequest.approvedEntitlements}) as approved
              where json_extract(approved.value, '$.entitlementId') = supplied.value
            )
          )`,
        ]
    return db
      .insert(externalTokenLease)
      .select(
        db
          .select({
            id: sql<string>`${input.id}`.as('id'),
            entitlementIds: sql<string[]>`${JSON.stringify(input.entitlementIds)}`.as('entitlement_ids'),
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
          .from(agentAccessRequest)
          .innerJoin(apiResource, eq(apiResource.id, agentAccessRequest.resourceId))
          .where(
            and(
              eq(agentAccessRequest.id, input.requestId),
              inArray(agentAccessRequest.status, ['approved', 'consumed']),
              ...entitlementConditions,
              or(
                isNull(agentAccessRequest.connectionId),
                exists(
                  db
                    .select({ id: providerResourceAuthorization.id })
                    .from(providerResourceAuthorization)
                    .where(
                      and(
                        eq(providerResourceAuthorization.id, agentAccessRequest.connectionId),
                        eq(providerResourceAuthorization.status, 'active'),
                      ),
                    ),
                ),
              ),
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
      accessRequestId: sql<string | null>`${audit.accessRequestId}`.as('access_request_id'),
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

async function toProviderResourceAuthorization(
  db: Database,
  authorization: typeof providerResourceAuthorization.$inferSelect,
  connection: ProviderConnectionRecord,
): Promise<ProviderResourceAuthorizationRecord> {
  const credentials = await db
    .select()
    .from(providerCredential)
    .where(eq(providerCredential.providerResourceAuthorizationId, authorization.id))
    .orderBy(providerCredential.createdAt)
  const activeCredentials = credentials.filter((credential) => credential.status === 'active')
  return {
    ...authorization,
    ownerUserId: connection.ownerUserId,
    ownerOrganizationId: connection.ownerOrganizationId,
    externalSubject: connection.externalSubject,
    displayName: connection.displayName,
    credentials,
    grantedScopes: [...new Set(activeCredentials.flatMap((credential) => credential.grantedScopes))].sort(),
    authorizationDetails: uniqueJsonValues(activeCredentials.flatMap((credential) => credential.authorizationDetails)),
  }
}

function uniqueJsonValues<T>(values: T[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
