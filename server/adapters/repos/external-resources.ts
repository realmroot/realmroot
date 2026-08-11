import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import type {
  AgentAccessRequestRecord,
  AgentAuditEventRecord,
  AgentAuthorityInventoryScope,
  ExternalResourceRepository,
  ProviderConnectionRecord,
  ProviderResourceAuthorizationRecord,
  ResourceScopeEntitlementRecord,
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
  resourceScopeEntitlement,
} from '../../db/schema'
import { scopeEntitlementStatusCondition } from './resource-scope-entitlement-filters'

export function createExternalResourceRepository(db: Database, ids: IdentifierGenerator): ExternalResourceRepository {
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
        .select({
          fingerprint: providerConnectionEventReceipt.fingerprint,
          appliedAt: providerConnectionEventReceipt.appliedAt,
        })
        .from(providerConnectionEventReceipt)
        .where(
          and(
            eq(providerConnectionEventReceipt.resource, input.resource),
            eq(providerConnectionEventReceipt.id, input.id),
          ),
        )
        .limit(1)
      if (existingReceipt) {
        return existingReceipt.fingerprint === input.fingerprint && existingReceipt.appliedAt ? 'duplicate' : 'conflict'
      }

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
      const acknowledgedEvent = exists(
        db
          .select({ id: providerResourceAuthorization.id })
          .from(providerResourceAuthorization)
          .where(
            and(
              eq(providerResourceAuthorization.id, target.authorization.id),
              claimedEvent,
              or(
                canApplyEvent,
                gt(providerResourceAuthorization.providerEventRevision, input.revision),
                input.type === 'revoked'
                  ? undefined
                  : and(
                      eq(providerResourceAuthorization.status, 'revoked'),
                      or(
                        isNull(providerResourceAuthorization.providerEventRevision),
                        lt(providerResourceAuthorization.providerEventRevision, input.revision),
                      ),
                    ),
              ),
            ),
          ),
      )
      const revokeEntitlement = authorityEntitlementInvalidationPredicate(
        input,
        resourceScopeEntitlement.authorizationDetails,
        resourceScopeEntitlement.scope,
      )
      const expireRequest =
        input.type === 'suspended'
          ? sql<boolean>`1`
          : authorityInvalidationPredicate(input, agentAccessRequest.authorizationDetails, agentAccessRequest.scopes)
      const revokeEveryLease = input.type === 'suspended' || input.type === 'revoked'
      const affectedEntitlement = exists(
        db
          .select({ id: resourceScopeEntitlement.id })
          .from(resourceScopeEntitlement)
          .where(
            and(
              sql`exists (
                select 1 from json_each(${externalTokenLease.entitlementIds}) as lease_entitlement
                where lease_entitlement.value = ${resourceScopeEntitlement.id}
              )`,
              eq(resourceScopeEntitlement.connectionId, target.authorization.id),
              revokeEveryLease ? undefined : eq(resourceScopeEntitlement.endReason, 'revoked'),
              currentEvent,
            ),
          ),
      )
      const snapshotConstraintInvalidations =
        input.type === 'resourcesChanged' || input.type === 'restored'
          ? authorityConstraintInvalidations(input.scopes, input.authorizationDetails, input.authorityConstraints)
          : []
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
          .update(resourceScopeEntitlement)
          .set({ endedAt: input.receivedAt, endReason: 'revoked', updatedAt: input.receivedAt })
          .where(
            and(
              eq(resourceScopeEntitlement.connectionId, target.authorization.id),
              isNull(resourceScopeEntitlement.endedAt),
              revokeEntitlement,
              currentEvent,
            ),
          ),
        ...snapshotConstraintInvalidations.flatMap(({ scope, authorizationDetails }) => [
          db
            .update(agentAccessRequest)
            .set({ status: 'expired', decidedAt: input.receivedAt, updatedAt: input.receivedAt })
            .where(
              and(
                eq(agentAccessRequest.connectionId, target.authorization.id),
                eq(agentAccessRequest.status, 'pending'),
                scopesContain(agentAccessRequest.scopes, scope),
                authorizationDetailsNotSubset(agentAccessRequest.authorizationDetails, authorizationDetails),
                currentEvent,
              ),
            ),
          db
            .update(resourceScopeEntitlement)
            .set({ endedAt: input.receivedAt, endReason: 'revoked', updatedAt: input.receivedAt })
            .where(
              and(
                eq(resourceScopeEntitlement.connectionId, target.authorization.id),
                isNull(resourceScopeEntitlement.endedAt),
                eq(resourceScopeEntitlement.scope, scope),
                authorizationDetailsNotSubset(resourceScopeEntitlement.authorizationDetails, authorizationDetails),
                currentEvent,
              ),
            ),
        ]),
        db
          .update(externalTokenLease)
          .set({ revokedAt: input.receivedAt })
          .where(and(isNull(externalTokenLease.revokedAt), affectedEntitlement)),
        db
          .update(providerConnection)
          .set({ status: providerConnectionStatus(target.connection.status, input.type), updatedAt: input.receivedAt })
          .where(and(eq(providerConnection.id, target.connection.id), currentEvent)),
        db
          .update(providerConnectionEventReceipt)
          .set({ appliedAt: input.receivedAt })
          .where(
            and(
              eq(providerConnectionEventReceipt.resource, input.resource),
              eq(providerConnectionEventReceipt.id, input.id),
              eq(providerConnectionEventReceipt.claimToken, claimToken),
              acknowledgedEvent,
            ),
          )
          .returning({ id: providerConnectionEventReceipt.id }),
        db
          .update(providerResourceAuthorization)
          .set({
            status: connectionAuthorizationStatus(target.authorization.status, input.type),
            ...(input.type === 'authorityChanged' || input.type === 'resourcesChanged' || input.type === 'restored'
              ? { grantedScopes: input.scopes, authorityConstraints: input.authorityConstraints }
              : {}),
            ...(input.type === 'resourcesChanged' || input.type === 'restored'
              ? { authorizationDetails: input.authorizationDetails }
              : {}),
            revokedAt: input.type === 'revoked' ? input.receivedAt : input.type === 'restored' ? null : undefined,
            providerEventOccurredAt: input.occurredAt,
            providerEventRevision: input.revision,
            updatedAt: input.receivedAt,
          })
          .where(and(eq(providerResourceAuthorization.id, target.authorization.id), canApplyEvent, claimedEvent)),
      ]
      const results = await db.batch(statements as [(typeof statements)[number], ...Array<(typeof statements)[number]>])
      const inserted = results[0]
      if (Array.isArray(inserted) && inserted.length > 0) {
        const acknowledged = results.at(-2)
        return Array.isArray(acknowledged) && acknowledged.length > 0 ? 'applied' : 'conflict'
      }
      const [racedReceipt] = await db
        .select({
          fingerprint: providerConnectionEventReceipt.fingerprint,
          appliedAt: providerConnectionEventReceipt.appliedAt,
        })
        .from(providerConnectionEventReceipt)
        .where(
          and(
            eq(providerConnectionEventReceipt.resource, input.resource),
            eq(providerConnectionEventReceipt.id, input.id),
          ),
        )
        .limit(1)
      return racedReceipt?.fingerprint === input.fingerprint && racedReceipt.appliedAt ? 'duplicate' : 'conflict'
    },

    async connectAuthenticationAccount(input) {
      const [connector] = await db
        .select({ id: identityProviderConnector.id })
        .from(identityProviderConnector)
        .where(eq(identityProviderConnector.providerId, input.providerId))
        .limit(1)
      if (!connector) return null
      return upsertProviderConnection({
        id: ids.generate(),
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
              authorityConstraints: sql<
                NonNullable<typeof input.authorityConstraints>
              >`${JSON.stringify(input.authorityConstraints ?? [])}`.as('authority_constraints'),
              clientGeneration: sql<number>`${input.clientGeneration ?? 1}`.as('client_generation'),
              credentialVersion: sql<number>`${input.credentialVersion ?? 1}`.as('credential_version'),
              refreshClaimId: sql<string | null>`${input.refreshClaimId ?? null}`.as('refresh_claim_id'),
              refreshClaimExpiresAt: sql<Date | null>`${input.refreshClaimExpiresAt?.getTime() ?? null}`.as(
                'refresh_claim_expires_at',
              ),
              status: sql<string>`${input.status}`.as('status'),
              credentialExpiresAt: sql<Date | null>`${input.credentialExpiresAt?.getTime() ?? null}`.as(
                'credential_expires_at',
              ),
              revokedAt: sql<Date | null>`${input.revokedAt?.getTime() ?? null}`.as('revoked_at'),
              providerEventOccurredAt: sql<Date | null>`${input.providerEventOccurredAt?.getTime() ?? null}`.as(
                'provider_event_occurred_at',
              ),
              providerEventRevision: sql<number | null>`${input.providerEventRevision ?? null}`.as(
                'provider_event_revision',
              ),
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

    async claimConnectionRefresh(input) {
      const [row] = await db
        .update(providerResourceAuthorization)
        .set({ refreshClaimId: input.claimId, refreshClaimExpiresAt: input.claimExpiresAt, updatedAt: input.now })
        .where(
          and(
            eq(providerResourceAuthorization.id, input.id),
            eq(providerResourceAuthorization.status, 'active'),
            eq(providerResourceAuthorization.credentialVersion, input.expectedVersion),
            or(
              isNull(providerResourceAuthorization.refreshClaimId),
              isNull(providerResourceAuthorization.refreshClaimExpiresAt),
              lte(providerResourceAuthorization.refreshClaimExpiresAt, input.now),
            ),
          ),
        )
        .returning({ id: providerResourceAuthorization.id })
      return Boolean(row)
    },

    async completeConnectionRefresh(id, input) {
      const [row] = await db
        .update(providerResourceAuthorization)
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
            eq(providerResourceAuthorization.id, id),
            eq(providerResourceAuthorization.status, 'active'),
            eq(providerResourceAuthorization.credentialVersion, input.expectedVersion),
            eq(providerResourceAuthorization.refreshClaimId, input.claimId),
          ),
        )
        .returning()
      if (!row) return null
      const connection = await findProviderConnection(db, row.providerConnectionId)
      return toProviderResourceAuthorization(row, connection)
    },

    async releaseConnectionRefresh(id, expectedVersion, claimId, now) {
      const [row] = await db
        .update(providerResourceAuthorization)
        .set({ refreshClaimId: null, refreshClaimExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(providerResourceAuthorization.id, id),
            eq(providerResourceAuthorization.status, 'active'),
            eq(providerResourceAuthorization.credentialVersion, expectedVersion),
            eq(providerResourceAuthorization.refreshClaimId, claimId),
          ),
        )
        .returning({ id: providerResourceAuthorization.id })
      return Boolean(row)
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

    async approveAccessRequestWithEntitlements(
      entitlements,
      entitlementUpdates,
      requestId,
      decision,
      audit,
      expectedConnectionRevision,
    ) {
      const statements = [
        ...entitlements.map((entitlement) => insertEntitlement(entitlement, requestId, expectedConnectionRevision)),
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
      if (inserted.length !== entitlements.length) return 'resource_unavailable'
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

    async issueTokenLeaseWithAudit(input, consumeEntitlementIds, now, audit) {
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

  function insertEntitlement(
    input: ResourceScopeEntitlementRecord,
    requestId: string,
    expectedConnectionRevision?: number | null,
  ) {
    const activeConnection = input.connectionId
      ? exists(
          db
            .select({ id: providerResourceAuthorization.id })
            .from(providerResourceAuthorization)
            .where(
              and(
                eq(providerResourceAuthorization.id, input.connectionId),
                eq(providerResourceAuthorization.status, 'active'),
                expectedConnectionRevision === undefined
                  ? undefined
                  : expectedConnectionRevision === null
                    ? isNull(providerResourceAuthorization.providerEventRevision)
                    : eq(providerResourceAuthorization.providerEventRevision, expectedConnectionRevision),
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
    return db.insert(resourceScopeEntitlement).select(source).returning()
  }

  function insertTokenLease(input: Parameters<ExternalResourceRepository['createTokenLease']>[0]) {
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
              sql`json_array_length(${agentAccessRequest.approvedEntitlements}) > 0`,
              sql`not exists (
                select 1
                from json_each(${agentAccessRequest.approvedEntitlements}) as approved
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
  | typeof resourceScopeEntitlement.authorizationDetails
  | typeof agentAccessRequest.authorizationDetails
type ScopesColumn = typeof agentAccessRequest.scopes

function authorityEntitlementInvalidationPredicate(
  event: ConnectionEventInput,
  detailsColumn: typeof resourceScopeEntitlement.authorizationDetails,
  scopeColumn: typeof resourceScopeEntitlement.scope,
) {
  if (event.type === 'revoked') return sql<boolean>`1`
  if (event.type === 'suspended') return sql<boolean>`0`
  if (event.type === 'authorityChanged') {
    const affected = authorizationDetailsOverlap(detailsColumn, event.affectedAuthorizationDetails)
    return sql<boolean>`(${affected} AND ${scopeNotIn(scopeColumn, event.affectedScopes)})`
  }
  if (event.type === 'resourcesChanged' || event.type === 'restored') {
    const scopeUnavailable = scopeNotIn(scopeColumn, event.scopes)
    const detailsUnavailable = authorizationDetailsNotSubset(detailsColumn, event.authorizationDetails)
    return sql<boolean>`(${scopeUnavailable} OR ${detailsUnavailable})`
  }
  return sql<boolean>`0`
}

function scopeNotIn(column: typeof resourceScopeEntitlement.scope, allowed: string[]) {
  if (allowed.length === 0) return sql<boolean>`1`
  return sql<boolean>`${column} NOT IN (${sql.join(
    allowed.map((scope) => sql`${scope}`),
    sql`, `,
  )})`
}

function authorityInvalidationPredicate(
  event: ConnectionEventInput,
  detailsColumn: AuthorizationDetailsColumn,
  scopesColumn: ScopesColumn,
) {
  if (event.type === 'revoked') return sql<boolean>`1`
  if (event.type === 'suspended') return sql<boolean>`0`
  if (event.type === 'authorityChanged') {
    const affected = authorizationDetailsOverlap(detailsColumn, event.affectedAuthorizationDetails)
    const exceedsResultingScopes = scopesNotSubset(scopesColumn, event.affectedScopes)
    return sql<boolean>`(${affected} AND ${exceedsResultingScopes})`
  }
  if (event.type === 'resourcesChanged' || event.type === 'restored') {
    const exceedsResultingScopes = scopesNotSubset(scopesColumn, event.scopes)
    const exceedsResultingResources = authorizationDetailsNotSubset(detailsColumn, event.authorizationDetails)
    return sql<boolean>`(${exceedsResultingScopes} OR ${exceedsResultingResources})`
  }
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

function authorityConstraintInvalidations(
  scopes: string[],
  authorizationDetails: unknown[],
  constraints: Extract<ConnectionEventInput, { type: 'resourcesChanged' }>['authorityConstraints'],
): Array<{ scope: string; authorizationDetails: unknown[] }> {
  return scopes.map((scope) => ({
    scope,
    authorizationDetails: authorizationDetails.filter((detail) =>
      constraints.some(
        (constraint) =>
          constraint.scopes.includes(scope) &&
          constraint.authorizationDetails.some((selector) => jsonSelectorCovers(detail, selector)),
      ),
    ),
  }))
}

function scopesContain(column: ScopesColumn, scope: string) {
  return sql<boolean>`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${scope})`
}

function jsonSelectorCovers(requested: unknown, selector: unknown): boolean {
  if (requested === null || selector === null) return requested === selector
  if (Array.isArray(requested)) {
    return (
      Array.isArray(selector) && requested.every((item) => selector.some((value) => jsonSelectorCovers(item, value)))
    )
  }
  if (typeof requested === 'object') {
    if (typeof selector !== 'object' || Array.isArray(selector)) return false
    return Object.entries(requested as Record<string, unknown>).every(([key, value]) =>
      jsonSelectorCovers(value, (selector as Record<string, unknown>)[key]),
    )
  }
  return requested === selector
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
