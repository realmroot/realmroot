import type {
  AgentAuditEventRecord,
  AgentAuthorityInventoryScope,
  ExternalResourceRepository,
  ProviderConnectionRecord,
  ProviderResourceAuthorizationRecord,
} from '@server/usecases/ports'
import {
  and,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  account,
  agentAccessGrant,
  agentAccessRequest,
  agentAuditEvent,
  agentConnectionRequest,
  agentIdentity,
  apiResource,
  externalTokenLease,
  identityProviderConnector,
  providerConnection,
  providerConnectionEventReceipt,
  providerResourceAuthorization,
  resourceConnectionIntent,
} from '../../db/schema'

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

  return {
    async applyProviderConnectionEvent(input) {
      const [existingReceipt] = await db
        .select({ fingerprint: providerConnectionEventReceipt.fingerprint })
        .from(providerConnectionEventReceipt)
        .where(
          and(
            eq(providerConnectionEventReceipt.resource, input.resource),
            eq(providerConnectionEventReceipt.id, input.id),
          ),
        )
        .limit(1)
      if (existingReceipt) return existingReceipt.fingerprint === input.fingerprint ? 'duplicate' : 'conflict'

      const targets = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .innerJoin(apiResource, eq(apiResource.id, providerResourceAuthorization.resourceId))
        .where(
          and(
            eq(apiResource.resourceUrl, input.resource),
            eq(providerResourceAuthorization.brokerReference, input.brokerReference),
          ),
        )
        .limit(2)
      if (targets.length !== 1) return 'not_found'
      const target = targets[0]!
      const claimToken = crypto.randomUUID()
      const claimedEvent = exists(
        db
          .select({ id: providerConnectionEventReceipt.id })
          .from(providerConnectionEventReceipt)
          .where(
            and(
              eq(providerConnectionEventReceipt.resource, input.resource),
              eq(providerConnectionEventReceipt.id, input.id),
              eq(providerConnectionEventReceipt.claimToken, claimToken),
            ),
          ),
      )
      const canApplyEvent = and(
        or(
          isNull(providerResourceAuthorization.providerEventRevision),
          lt(providerResourceAuthorization.providerEventRevision, input.revision),
        ),
        input.type === 'revoked' ? undefined : ne(providerResourceAuthorization.status, 'revoked'),
      )
      const currentEvent = exists(
        db
          .select({ id: providerResourceAuthorization.id })
          .from(providerResourceAuthorization)
          .where(and(eq(providerResourceAuthorization.id, target.authorization.id), canApplyEvent, claimedEvent)),
      )
      const revokeGrant = authorityInvalidationPredicate(
        input,
        agentAccessGrant.authorizationDetails,
        agentAccessGrant.scopes,
      )
      const expireRequest =
        input.type === 'suspended'
          ? sql<boolean>`1`
          : authorityInvalidationPredicate(input, agentAccessRequest.authorizationDetails, agentAccessRequest.scopes)
      const revokeEveryLease = input.type === 'suspended' || input.type === 'revoked'
      const affectedGrant = exists(
        db
          .select({ id: agentAccessGrant.id })
          .from(agentAccessGrant)
          .where(
            and(
              eq(agentAccessGrant.id, externalTokenLease.grantId),
              eq(agentAccessGrant.connectionId, target.authorization.id),
              revokeEveryLease ? undefined : eq(agentAccessGrant.status, 'revoked'),
              currentEvent,
            ),
          ),
      )
      const statements = [
        db
          .insert(providerConnectionEventReceipt)
          .values({
            resource: input.resource,
            id: input.id,
            fingerprint: input.fingerprint,
            claimToken,
            occurredAt: input.occurredAt,
            revision: input.revision,
            receivedAt: input.receivedAt,
            appliedAt: null,
          })
          .onConflictDoNothing()
          .returning({ id: providerConnectionEventReceipt.id }),
        db
          .update(agentAccessRequest)
          .set({ status: 'expired', decidedAt: input.receivedAt, updatedAt: input.receivedAt })
          .where(
            and(
              eq(agentAccessRequest.connectionId, target.authorization.id),
              eq(agentAccessRequest.status, 'pending'),
              expireRequest,
              currentEvent,
            ),
          ),
        db
          .update(agentAccessGrant)
          .set({ status: 'revoked', revokedAt: input.receivedAt, updatedAt: input.receivedAt })
          .where(
            and(
              eq(agentAccessGrant.connectionId, target.authorization.id),
              eq(agentAccessGrant.status, 'active'),
              revokeGrant,
              currentEvent,
            ),
          ),
        db
          .update(externalTokenLease)
          .set({ revokedAt: input.receivedAt })
          .where(and(isNull(externalTokenLease.revokedAt), affectedGrant)),
        db
          .update(providerConnection)
          .set({ status: providerConnectionStatus(target.connection.status, input.type), updatedAt: input.receivedAt })
          .where(and(eq(providerConnection.id, target.connection.id), currentEvent)),
        db
          .update(providerResourceAuthorization)
          .set({
            status: connectionAuthorizationStatus(target.authorization.status, input.type),
            ...(input.scopes ? { grantedScopes: input.scopes } : {}),
            ...(input.authorizationDetails ? { authorizationDetails: input.authorizationDetails } : {}),
            revokedAt: input.type === 'revoked' ? input.receivedAt : input.type === 'restored' ? null : undefined,
            providerEventOccurredAt: input.occurredAt,
            providerEventRevision: input.revision,
            updatedAt: input.receivedAt,
          })
          .where(and(eq(providerResourceAuthorization.id, target.authorization.id), canApplyEvent, claimedEvent)),
        db
          .update(providerConnectionEventReceipt)
          .set({ appliedAt: input.receivedAt })
          .where(
            and(
              eq(providerConnectionEventReceipt.resource, input.resource),
              eq(providerConnectionEventReceipt.id, input.id),
              eq(providerConnectionEventReceipt.claimToken, claimToken),
            ),
          ),
      ]
      const results = await db.batch(statements as [(typeof statements)[number], ...Array<(typeof statements)[number]>])
      const inserted = results[0]
      if (Array.isArray(inserted) && inserted.length > 0) return 'applied'
      const [racedReceipt] = await db
        .select({ fingerprint: providerConnectionEventReceipt.fingerprint })
        .from(providerConnectionEventReceipt)
        .where(
          and(
            eq(providerConnectionEventReceipt.resource, input.resource),
            eq(providerConnectionEventReceipt.id, input.id),
          ),
        )
        .limit(1)
      return racedReceipt?.fingerprint === input.fingerprint ? 'duplicate' : 'conflict'
    },

    async connectAuthenticationAccount(input) {
      const [connector] = await db
        .select({ id: identityProviderConnector.id })
        .from(identityProviderConnector)
        .where(eq(identityProviderConnector.providerId, input.providerId))
        .limit(1)
      if (!connector) return null
      return upsertProviderConnection({
        id: `provconn_${crypto.randomUUID().replaceAll('-', '')}`,
        connectorId: connector.id,
        ownerUserId: input.userId,
        ownerOrganizationId: null,
        authenticationAccountId: input.authenticationAccountId,
        externalSubject: input.externalSubject,
        displayName: input.externalSubject,
        status: 'active',
        createdAt: input.now,
        updatedAt: input.now,
      })
    },

    async disconnectAuthenticationAccount(authenticationAccountId) {
      const [connection] = await db
        .update(providerConnection)
        .set({ authenticationAccountId: null, updatedAt: new Date() })
        .where(eq(providerConnection.authenticationAccountId, authenticationAccountId))
        .returning({ id: providerConnection.id })
      if (!connection) return
      const [authorization] = await db
        .select({ id: providerResourceAuthorization.id })
        .from(providerResourceAuthorization)
        .where(eq(providerResourceAuthorization.providerConnectionId, connection.id))
        .limit(1)
      if (!authorization) await db.delete(providerConnection).where(eq(providerConnection.id, connection.id))
    },

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

    async findActiveUserProviderConnectionBySubject(input) {
      const [row] = await db
        .select()
        .from(providerConnection)
        .where(
          and(
            eq(providerConnection.connectorId, input.connectorId),
            eq(providerConnection.externalSubject, input.externalSubject),
            eq(providerConnection.status, 'active'),
            isNotNull(providerConnection.ownerUserId),
          ),
        )
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
            loginEnabled: connector.loginEnabled,
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

    async createConnection(input) {
      const [row] = await db
        .insert(providerResourceAuthorization)
        .select(
          db
            .select({
              id: sql<string>`${input.id}`.as('id'),
              providerConnectionId: sql<string>`${input.providerConnectionId}`.as('provider_connection_id'),
              resourceId: apiResource.id,
              credentialCustody: sql<'realmroot' | 'resource_server'>`${input.credentialCustody ?? 'realmroot'}`.as(
                'credential_custody',
              ),
              encryptedTokens: sql<string | null>`${input.encryptedTokens}`.as('encrypted_tokens'),
              brokerReference: sql<string | null>`${input.brokerReference ?? null}`.as('broker_reference'),
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
      if (!row) return null
      const connection = await findProviderConnection(db, row.providerConnectionId)
      return toProviderResourceAuthorization(row, connection)
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
      return row ? toProviderResourceAuthorization(row.authorization, row.connection) : null
    },

    async replaceConnectionAuthorization(id, resourceId, input) {
      const [row] = await db
        .update(providerResourceAuthorization)
        .set(input)
        .where(
          and(
            eq(providerResourceAuthorization.id, id),
            eq(providerResourceAuthorization.resourceId, resourceId),
            exists(db.select({ id: apiResource.id }).from(apiResource).where(activeResource(resourceId))),
          ),
        )
        .returning()
      if (!row) return null
      const connection = await findProviderConnection(db, row.providerConnectionId)
      return toProviderResourceAuthorization(row, connection)
    },

    async listConnectionsByUser(userId) {
      const rows = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(eq(providerConnection.ownerUserId, userId))
        .orderBy(providerResourceAuthorization.createdAt)
      return rows.map((row) => toProviderResourceAuthorization(row.authorization, row.connection))
    },

    async listConnectionsByOrganizations(organizationIds) {
      if (organizationIds.length === 0) return []
      const rows = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(inArray(providerConnection.ownerOrganizationId, organizationIds))
        .orderBy(providerResourceAuthorization.createdAt)
      return rows.map((row) => toProviderResourceAuthorization(row.authorization, row.connection))
    },

    async findConnection(id) {
      const [row] = await db
        .select({ authorization: providerResourceAuthorization, connection: providerConnection })
        .from(providerResourceAuthorization)
        .innerJoin(providerConnection, eq(providerConnection.id, providerResourceAuthorization.providerConnectionId))
        .where(eq(providerResourceAuthorization.id, id))
        .limit(1)
      return row ? toProviderResourceAuthorization(row.authorization, row.connection) : null
    },

    async updateConnectionTokens(id, input) {
      const [row] = await db
        .update(providerResourceAuthorization)
        .set(input)
        .where(and(eq(providerResourceAuthorization.id, id), eq(providerResourceAuthorization.status, 'active')))
        .returning()
      if (!row) return null
      const connection = await findProviderConnection(db, row.providerConnectionId)
      return toProviderResourceAuthorization(row, connection)
    },

    async revokeConnection(id, now) {
      const [row] = await db
        .update(providerResourceAuthorization)
        .set({ status: 'revoked', revokedAt: now, updatedAt: now })
        .where(and(eq(providerResourceAuthorization.id, id), eq(providerResourceAuthorization.status, 'active')))
        .returning({ id: providerResourceAuthorization.id })
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
              authorizationMode: sql<'oauth' | 'brokered'>`${input.authorizationMode ?? 'oauth'}`.as(
                'authorization_mode',
              ),
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
          .where(and(activeResource(input.resourceId), activeConnection))
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
          .where(and(activeResource(input.resourceId), activeConnection))
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
              inArray(agentAccessRequest.status, ['approved', 'consumed']),
            ),
          )
          .where(
            and(
              eq(agentAccessGrant.id, input.grantId),
              eq(agentAccessGrant.status, 'active'),
              or(
                isNull(agentAccessGrant.connectionId),
                exists(
                  db
                    .select({ id: providerResourceAuthorization.id })
                    .from(providerResourceAuthorization)
                    .where(
                      and(
                        eq(providerResourceAuthorization.id, agentAccessGrant.connectionId),
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

async function findProviderConnection(db: Database, id: string) {
  const [connection] = await db.select().from(providerConnection).where(eq(providerConnection.id, id)).limit(1)
  if (!connection) throw new Error('Provider Resource Authorization has no Provider Connection.')
  return connection
}

function toProviderResourceAuthorization(
  authorization: typeof providerResourceAuthorization.$inferSelect,
  connection: ProviderConnectionRecord,
): ProviderResourceAuthorizationRecord {
  return {
    ...authorization,
    ownerUserId: connection.ownerUserId,
    ownerOrganizationId: connection.ownerOrganizationId,
    externalSubject: connection.externalSubject,
    displayName: connection.displayName,
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

type ConnectionEventInput = Parameters<ExternalResourceRepository['applyProviderConnectionEvent']>[0]

type AuthorizationDetailsColumn =
  | typeof agentAccessGrant.authorizationDetails
  | typeof agentAccessRequest.authorizationDetails
type ScopesColumn = typeof agentAccessGrant.scopes | typeof agentAccessRequest.scopes

function authorityInvalidationPredicate(
  event: ConnectionEventInput,
  detailsColumn: AuthorizationDetailsColumn,
  scopesColumn: ScopesColumn,
) {
  if (event.type === 'revoked') return sql<boolean>`1`
  if (event.type === 'suspended') return sql<boolean>`0`
  if (event.affectedAuthorizationDetails?.length) {
    const affected = authorizationDetailsOverlap(detailsColumn, event.affectedAuthorizationDetails)
    const exceedsResultingScopes = event.scopes ? scopesNotSubset(scopesColumn, event.scopes) : sql<boolean>`1`
    return sql<boolean>`(${affected} AND ${exceedsResultingScopes})`
  }
  const exceedsResultingScopes = event.scopes ? scopesNotSubset(scopesColumn, event.scopes) : sql<boolean>`0`
  if (event.authorizationDetails) {
    const exceedsResultingResources = authorizationDetailsNotSubset(detailsColumn, event.authorizationDetails)
    return sql<boolean>`(${exceedsResultingResources} OR ${exceedsResultingScopes})`
  }
  if (event.scopes) return exceedsResultingScopes
  return sql<boolean>`0`
}

function scopesNotSubset(column: ScopesColumn, allowed: string[]) {
  const allowedJson = JSON.stringify(allowed)
  return sql<boolean>`EXISTS (
    SELECT 1
    FROM json_each(${column}) AS requested_scope
    WHERE NOT EXISTS (
      SELECT 1 FROM json_each(${allowedJson}) AS allowed_scope
      WHERE allowed_scope.value = requested_scope.value
    )
  )`
}

function authorizationDetailsOverlap(column: AuthorizationDetailsColumn, affected: unknown[]) {
  const aliases = { next: 0 }
  const grantDetail = jsonNode('grant_detail')
  const matchesAffected = joinPredicates(
    affected.map((detail) => jsonNodeIsSubsetOf(grantDetail, detail, aliases)),
    'OR',
  )
  return sql<boolean>`(
    json_array_length(${column}) = 0 OR EXISTS (
      SELECT 1
      FROM json_each(${column}) AS grant_detail
      WHERE ${matchesAffected}
    )
  )`
}

function authorizationDetailsNotSubset(column: AuthorizationDetailsColumn, allowed: unknown[]) {
  const aliases = { next: 0 }
  const grantDetail = jsonNode('grant_detail')
  const matchesAllowed = joinPredicates(
    allowed.map((detail) => jsonNodeIsSubsetOf(grantDetail, detail, aliases)),
    'OR',
  )
  return sql<boolean>`(
    json_array_length(${column}) = 0 OR EXISTS (
      SELECT 1
      FROM json_each(${column}) AS grant_detail
      WHERE NOT (${matchesAllowed})
    )
  )`
}

interface JsonNodeSql {
  value: SQL
  type: SQL
  atom: SQL
}

function jsonNode(alias: string): JsonNodeSql {
  const identifier = sql.identifier(alias)
  return {
    value: sql`${identifier}.value`,
    type: sql`${identifier}.type`,
    atom: sql`${identifier}.atom`,
  }
}

function jsonNodeIsSubsetOf(node: JsonNodeSql, allowed: unknown, aliases: { next: number }): SQL<boolean> {
  if (allowed === null) return sql<boolean>`${node.type} = 'null'`
  if (typeof allowed === 'string') return sql<boolean>`${node.type} = 'text' AND ${node.atom} = ${allowed}`
  if (typeof allowed === 'boolean') {
    return sql<boolean>`${node.type} = ${allowed ? 'true' : 'false'}`
  }
  if (typeof allowed === 'number') {
    return sql<boolean>`${node.type} IN ('integer', 'real') AND ${node.atom} = ${allowed}`
  }
  if (Array.isArray(allowed)) {
    const alias = `connection_event_array_${aliases.next++}`
    const item = jsonNode(alias)
    const matchesAllowedItem = joinPredicates(
      allowed.map((allowedItem) => jsonNodeIsSubsetOf(item, allowedItem, aliases)),
      'OR',
    )
    return sql<boolean>`(
      ${node.type} = 'array' AND NOT EXISTS (
        SELECT 1 FROM json_each(CASE WHEN ${node.type} = 'array' THEN ${node.value} ELSE 'null' END)
          AS ${sql.identifier(alias)}
        WHERE NOT (${matchesAllowedItem})
      )
    )`
  }
  const alias = `connection_event_object_${aliases.next++}`
  const member = jsonNode(alias)
  const matchesAllowedMember = joinPredicates(
    Object.entries(allowed as Record<string, unknown>).map(
      ([key, value]) =>
        sql<boolean>`(${sql`${sql.identifier(alias)}.key`} = ${key} AND ${jsonNodeIsSubsetOf(member, value, aliases)})`,
    ),
    'OR',
  )
  return sql<boolean>`(
    ${node.type} = 'object' AND NOT EXISTS (
      SELECT 1 FROM json_each(CASE WHEN ${node.type} = 'object' THEN ${node.value} ELSE 'null' END)
        AS ${sql.identifier(alias)}
      WHERE NOT (${matchesAllowedMember})
    )
  )`
}

function joinPredicates(predicates: SQL<boolean>[], separator: 'AND' | 'OR'): SQL<boolean> {
  if (predicates.length === 0) return sql<boolean>`0`
  return sql<boolean>`(${sql.join(predicates, sql.raw(` ${separator} `))})`
}

function providerConnectionStatus(
  current: ProviderConnectionRecord['status'],
  type: ConnectionEventInput['type'],
): ProviderConnectionRecord['status'] {
  if (type === 'suspended') return 'suspended'
  if (type === 'restored') return 'active'
  if (type === 'revoked') return 'revoked'
  return current
}

function connectionAuthorizationStatus(current: string, type: ConnectionEventInput['type']) {
  if (type === 'suspended') return 'suspended'
  if (type === 'restored') return 'active'
  if (type === 'revoked') return 'revoked'
  return current
}
