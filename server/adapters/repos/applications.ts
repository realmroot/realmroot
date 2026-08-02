import type { ApplicationRepository } from '@server/usecases/ports'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  application,
  applicationAudienceOrganization,
  applicationAudienceUser,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
  user,
} from '../../db/schema'
import {
  isScope,
  serializeList,
  toAggregate,
  toApplicationInsert,
  toConsent,
  toOAuthClientInsert,
  toPaginationMetadata,
  writeApplicationMetadata,
} from './applications-mappers'

const _corsOriginsMetadataKey = 'corsOrigins'
const _customDataMetadataKey = 'customData'
const _iconUrlMetadataKey = 'iconUrl'
const _oidcClaimsMetadataKey = 'oidcClaims'

export function createDrizzleApplicationRepository(db: Database): ApplicationRepository {
  return {
    async create(input) {
      const now = new Date()
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db
          .insert(oauthClient)
          .values(toOAuthClientInsert(input.application, input.clientSecret?.secretHash ?? null, now)),
        db.insert(application).values(toApplicationInsert(input.application, now)),
        db.insert(applicationClientMetadata).values({
          applicationId: input.application.id,
        }),
      ]
      if (input.clientSecret) {
        statements.push(
          db.insert(applicationClientSecret).values({
            ...input.clientSecret,
            applicationId: input.application.id,
            materializedToOauthClientAt: now,
          }),
        )
      }
      if (input.application.audience.organizationIds.length > 0) {
        statements.push(
          db.insert(applicationAudienceOrganization).values(
            input.application.audience.organizationIds.map((organizationId) => ({
              applicationId: input.application.id,
              organizationId,
            })),
          ),
        )
      }
      if (input.application.audience.userIds.length > 0) {
        statements.push(
          db
            .insert(applicationAudienceUser)
            .values(
              input.application.audience.userIds.map((userId) => ({ applicationId: input.application.id, userId })),
            ),
        )
      }
      await db.batch(statements)
      return {
        ...input.application,
        createdAt: now,
        updatedAt: now,
      }
    },

    async list(pagination, ownerOrganizationIds) {
      if (ownerOrganizationIds?.length === 0) {
        return { items: [], pagination: toPaginationMetadata(pagination, 0) }
      }
      const ownerCondition = ownerOrganizationIds
        ? inArray(application.ownerOrganizationId, ownerOrganizationIds)
        : undefined
      const rows = await db
        .select({ application, oauthClient })
        .from(application)
        .innerJoin(oauthClient, eq(application.oauthClientId, oauthClient.clientId))
        .where(ownerCondition)
        .orderBy(desc(application.createdAt), desc(application.id))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const totalRows = await db.select({ total: count() }).from(application).where(ownerCondition)
      const total = totalRows[0]?.total ?? 0
      const audiences = await loadApplicationAudiences(
        db,
        rows.map((row) => row.application.id),
      )
      return {
        items: rows.map((row) => toAggregate(row.application, row.oauthClient, audiences.get(row.application.id))),
        pagination: toPaginationMetadata(pagination, total),
      }
    },

    async findById(id) {
      const rows = await db
        .select({ application, oauthClient })
        .from(application)
        .innerJoin(oauthClient, eq(application.oauthClientId, oauthClient.clientId))
        .where(eq(application.id, id))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      const audiences = await loadApplicationAudiences(db, [row.application.id])
      return toAggregate(row.application, row.oauthClient, audiences.get(row.application.id))
    },

    async findByClientId(clientId) {
      const rows = await db
        .select({ application, oauthClient })
        .from(application)
        .innerJoin(oauthClient, eq(application.oauthClientId, oauthClient.clientId))
        .where(eq(oauthClient.clientId, clientId))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      const audiences = await loadApplicationAudiences(db, [row.application.id])
      return toAggregate(row.application, row.oauthClient, audiences.get(row.application.id))
    },

    async update(id, patch) {
      const now = new Date()
      const currentRows = await db.select().from(application).where(eq(application.id, id)).limit(1)
      const current = currentRows[0]
      if (!current) return

      const applicationPatch = {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.homepageUrl !== undefined ? { homepageUrl: patch.homepageUrl } : {}),
        ...(patch.ownerOrganizationId !== undefined ? { ownerOrganizationId: patch.ownerOrganizationId } : {}),
        ...(patch.audience !== undefined ? { audienceMode: patch.audience.mode } : {}),
        ...(patch.iconUrl !== undefined ||
        patch.corsOrigins !== undefined ||
        patch.customData !== undefined ||
        patch.oidcClaims !== undefined
          ? {
              metadata: writeApplicationMetadata(current.metadata, {
                iconUrl: patch.iconUrl,
                corsOrigins: patch.corsOrigins,
                customData: patch.customData,
                oidcClaims: patch.oidcClaims,
              }),
            }
          : {}),
        ...(patch.firstParty !== undefined ? { firstParty: patch.firstParty } : {}),
        ...(patch.trusted !== undefined ? { trusted: patch.trusted } : {}),
        ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
        ...(patch.disabledReason !== undefined ? { disabledReason: patch.disabledReason } : {}),
        updatedAt: now,
      }

      const oauthPatch = {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.homepageUrl !== undefined ? { uri: patch.homepageUrl } : {}),
        ...(patch.iconUrl !== undefined ? { icon: patch.iconUrl } : {}),
        ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
        ...(patch.trusted !== undefined ? { skipConsent: patch.trusted } : {}),
        ...(patch.redirectUris !== undefined ? { redirectUris: serializeList(patch.redirectUris) } : {}),
        ...(patch.postLogoutRedirectUris !== undefined
          ? { postLogoutRedirectUris: serializeList(patch.postLogoutRedirectUris), enableEndSession: true }
          : {}),
        ...(patch.allowedGrantTypes !== undefined ? { grantTypes: serializeList(patch.allowedGrantTypes) } : {}),
        ...(patch.allowedScopes !== undefined ? { scopes: serializeList(patch.allowedScopes) } : {}),
        ...(patch.oidcClaims !== undefined
          ? { metadata: JSON.stringify({ applicationId: id, oidcClaims: patch.oidcClaims }) }
          : {}),
        updatedAt: now,
      }
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db.update(application).set(applicationPatch).where(eq(application.id, id)),
        db.update(oauthClient).set(oauthPatch).where(eq(oauthClient.clientId, current.oauthClientId)),
      ]
      if (patch.audience !== undefined) {
        statements.push(
          db.delete(applicationAudienceOrganization).where(eq(applicationAudienceOrganization.applicationId, id)),
          db.delete(applicationAudienceUser).where(eq(applicationAudienceUser.applicationId, id)),
        )
        if (patch.audience.organizationIds.length > 0) {
          statements.push(
            db
              .insert(applicationAudienceOrganization)
              .values(patch.audience.organizationIds.map((organizationId) => ({ applicationId: id, organizationId }))),
          )
        }
        if (patch.audience.userIds.length > 0) {
          statements.push(
            db
              .insert(applicationAudienceUser)
              .values(patch.audience.userIds.map((userId) => ({ applicationId: id, userId }))),
          )
        }
      }
      await db.batch(statements)
    },

    async delete(id) {
      const rows = await db.select().from(application).where(eq(application.id, id)).limit(1)
      const app = rows[0]
      if (app) {
        await db.delete(oauthClient).where(eq(oauthClient.clientId, app.oauthClientId))
      }
    },

    async listSecrets(applicationId, pagination) {
      const rows = await db
        .select()
        .from(applicationClientSecret)
        .where(eq(applicationClientSecret.applicationId, applicationId))
        .orderBy(desc(applicationClientSecret.version))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const totalRows = await db
        .select({ total: count() })
        .from(applicationClientSecret)
        .where(eq(applicationClientSecret.applicationId, applicationId))
      const total = totalRows[0]?.total ?? 0
      return {
        items: rows,
        pagination: toPaginationMetadata(pagination, total),
      }
    },

    async rotateSecret(input) {
      const now = new Date()
      const versions = await db
        .select({ version: applicationClientSecret.version })
        .from(applicationClientSecret)
        .where(eq(applicationClientSecret.applicationId, input.applicationId))
        .orderBy(desc(applicationClientSecret.version))
        .limit(1)
      const version = (versions[0]?.version ?? 0) + 1

      const rows = await db.select().from(application).where(eq(application.id, input.applicationId)).limit(1)
      const app = rows[0]
      if (app) {
        await db.batch([
          db
            .update(applicationClientSecret)
            .set({ status: 'revoked', revokedAt: now })
            .where(
              and(
                eq(applicationClientSecret.applicationId, input.applicationId),
                eq(applicationClientSecret.status, 'active'),
              ),
            ),
          db.insert(applicationClientSecret).values({
            ...input.secret,
            version,
            applicationId: input.applicationId,
            materializedToOauthClientAt: now,
          }),
          db
            .update(oauthClient)
            .set({ clientSecret: input.secret.secretHash, updatedAt: now })
            .where(eq(oauthClient.clientId, app.oauthClientId)),
        ])
      }

      return {
        ...input.secret,
        version,
        createdAt: now,
        expiresAt: null,
        revokedAt: null,
      }
    },

    async listAuthorizations(query, ownerOrganizationIds) {
      if (ownerOrganizationIds?.length === 0) {
        return { items: [], pagination: toPaginationMetadata(query, 0) }
      }
      const now = new Date()
      const statusCondition =
        query.status === 'revoked'
          ? isNotNull(applicationConsent.revokedAt)
          : query.status === 'expired'
            ? and(isNull(applicationConsent.revokedAt), lte(applicationConsent.expiresAt, now))
            : query.status === 'active'
              ? and(
                  isNull(applicationConsent.revokedAt),
                  or(isNull(applicationConsent.expiresAt), gt(applicationConsent.expiresAt, now)),
                )
              : undefined
      const where = and(
        query.applicationId ? eq(applicationConsent.applicationId, query.applicationId) : undefined,
        ownerOrganizationIds ? inArray(application.ownerOrganizationId, ownerOrganizationIds) : undefined,
        statusCondition,
      )
      const rows = await db
        .select({
          id: applicationConsent.id,
          applicationId: applicationConsent.applicationId,
          userId: user.id,
          userDisplayName: user.name,
          userEmail: user.email,
          organizationId: organization.id,
          organizationName: organization.name,
          scopes: applicationConsent.scopes,
          permissions: applicationConsent.permissions,
          grantedAt: applicationConsent.grantedAt,
          expiresAt: applicationConsent.expiresAt,
          revokedAt: applicationConsent.revokedAt,
        })
        .from(applicationConsent)
        .innerJoin(application, eq(applicationConsent.applicationId, application.id))
        .innerJoin(user, eq(applicationConsent.userId, user.id))
        .leftJoin(organization, eq(applicationConsent.organizationId, organization.id))
        .where(where)
        .orderBy(desc(applicationConsent.grantedAt), desc(applicationConsent.id))
        .limit(query.limit)
        .offset(query.offset)
      const totalRows = await db
        .select({ total: count() })
        .from(applicationConsent)
        .innerJoin(application, eq(applicationConsent.applicationId, application.id))
        .where(where)

      return {
        items: rows.map((row) => ({
          ...row,
          scopes: row.scopes.filter(isScope),
          permissions: row.permissions ?? [],
        })),
        pagination: toPaginationMetadata(query, totalRows[0]?.total ?? 0),
      }
    },

    async findAuthorization(authorizationId) {
      const [row] = await db
        .select({
          id: applicationConsent.id,
          applicationId: applicationConsent.applicationId,
          userId: user.id,
          userDisplayName: user.name,
          userEmail: user.email,
          organizationId: organization.id,
          organizationName: organization.name,
          scopes: applicationConsent.scopes,
          permissions: applicationConsent.permissions,
          grantedAt: applicationConsent.grantedAt,
          expiresAt: applicationConsent.expiresAt,
          revokedAt: applicationConsent.revokedAt,
        })
        .from(applicationConsent)
        .innerJoin(user, eq(applicationConsent.userId, user.id))
        .leftJoin(organization, eq(applicationConsent.organizationId, organization.id))
        .where(eq(applicationConsent.id, authorizationId))
        .limit(1)
      return row ? { ...row, scopes: row.scopes.filter(isScope), permissions: row.permissions ?? [] } : null
    },

    async revokeAuthorization(authorizationId) {
      const row = await findAuthorizationGrant(db, { authorizationId })
      if (!row) return false
      await revokeAuthorizationGrant(db, row)
      return true
    },

    async findConsent(applicationId, userId) {
      const rows = await db
        .select()
        .from(applicationConsent)
        .where(
          and(
            eq(applicationConsent.applicationId, applicationId),
            eq(applicationConsent.userId, userId),
            isNull(applicationConsent.revokedAt),
          ),
        )
        .orderBy(desc(applicationConsent.grantedAt))
        .limit(1)
      return rows[0] ? toConsent(rows[0]) : null
    },

    async revokeConsent(consentId, userId) {
      const row = await findAuthorizationGrant(db, { authorizationId: consentId, userId })
      if (!row) return false
      await revokeAuthorizationGrant(db, row)
      return true
    },

    async createConsent(input) {
      const now = new Date()
      const [existingApplicationConsent, existingOAuthConsent] = await Promise.all([
        db
          .select({ id: applicationConsent.id })
          .from(applicationConsent)
          .where(
            and(
              eq(applicationConsent.applicationId, input.applicationId),
              eq(applicationConsent.userId, input.userId),
              isNull(applicationConsent.revokedAt),
            ),
          )
          .limit(1),
        db
          .select({ id: oauthConsent.id })
          .from(oauthConsent)
          .where(
            and(
              eq(oauthConsent.clientId, input.clientId),
              eq(oauthConsent.userId, input.userId),
              isNull(oauthConsent.referenceId),
            ),
          )
          .limit(1),
      ])
      const id = existingApplicationConsent[0]?.id ?? `consent_${crypto.randomUUID().replaceAll('-', '')}`
      const applicationStatement = existingApplicationConsent[0]
        ? db
            .update(applicationConsent)
            .set({ scopes: input.scopes, permissions: input.permissions, grantedAt: now, expiresAt: null })
            .where(eq(applicationConsent.id, id))
        : db.insert(applicationConsent).values({
            id,
            applicationId: input.applicationId,
            userId: input.userId,
            scopes: input.scopes,
            permissions: input.permissions,
            grantedAt: now,
          })
      const oauthStatement = existingOAuthConsent[0]
        ? db
            .update(oauthConsent)
            .set({ scopes: serializeList(input.scopes), updatedAt: now })
            .where(eq(oauthConsent.id, existingOAuthConsent[0].id))
        : db.insert(oauthConsent).values({
            id: `oauthconsent_${crypto.randomUUID().replaceAll('-', '')}`,
            clientId: input.clientId,
            userId: input.userId,
            scopes: serializeList(input.scopes),
            createdAt: now,
            updatedAt: now,
          })
      await db.batch([applicationStatement, oauthStatement])

      const [consent] = await db
        .select()
        .from(applicationConsent)
        .where(
          and(
            eq(applicationConsent.applicationId, input.applicationId),
            eq(applicationConsent.userId, input.userId),
            isNull(applicationConsent.revokedAt),
          ),
        )
        .limit(1)
      if (!consent) throw new Error('Persisted application consent was not found.')
      return toConsent(consent)
    },
  }
}

async function findAuthorizationGrant(
  db: Database,
  selector:
    | { applicationId: string; authorizationId: string }
    | { authorizationId: string; userId: string }
    | { authorizationId: string },
) {
  const ownershipCondition =
    'applicationId' in selector
      ? eq(applicationConsent.applicationId, selector.applicationId)
      : 'userId' in selector
        ? eq(applicationConsent.userId, selector.userId)
        : undefined
  const [row] = await db
    .select({
      applicationId: applicationConsent.applicationId,
      clientId: application.oauthClientId,
      userId: applicationConsent.userId,
    })
    .from(applicationConsent)
    .innerJoin(application, eq(applicationConsent.applicationId, application.id))
    .where(
      and(
        eq(applicationConsent.id, selector.authorizationId),
        ownershipCondition,
        isNull(applicationConsent.revokedAt),
      ),
    )
    .limit(1)
  return row ?? null
}

async function revokeAuthorizationGrant(
  db: Database,
  grant: { applicationId: string; clientId: string; userId: string },
) {
  const now = new Date()
  await db.batch([
    db
      .update(applicationConsent)
      .set({ revokedAt: now })
      .where(
        and(
          eq(applicationConsent.applicationId, grant.applicationId),
          eq(applicationConsent.userId, grant.userId),
          isNull(applicationConsent.revokedAt),
        ),
      ),
    db
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.clientId, grant.clientId), eq(oauthConsent.userId, grant.userId))),
    db
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.clientId, grant.clientId), eq(oauthAccessToken.userId, grant.userId))),
    db
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(
        and(
          eq(oauthRefreshToken.clientId, grant.clientId),
          eq(oauthRefreshToken.userId, grant.userId),
          isNull(oauthRefreshToken.revoked),
        ),
      ),
  ])
}

async function loadApplicationAudiences(db: Database, applicationIds: string[]) {
  const audiences = new Map<string, { organizationIds: string[]; userIds: string[] }>()
  for (const id of applicationIds) audiences.set(id, { organizationIds: [], userIds: [] })
  if (applicationIds.length === 0) return audiences
  const [organizations, users] = await Promise.all([
    db
      .select({
        applicationId: applicationAudienceOrganization.applicationId,
        id: applicationAudienceOrganization.organizationId,
      })
      .from(applicationAudienceOrganization)
      .where(inArray(applicationAudienceOrganization.applicationId, applicationIds)),
    db
      .select({ applicationId: applicationAudienceUser.applicationId, id: applicationAudienceUser.userId })
      .from(applicationAudienceUser)
      .where(inArray(applicationAudienceUser.applicationId, applicationIds)),
  ])
  for (const selection of organizations) audiences.get(selection.applicationId)?.organizationIds.push(selection.id)
  for (const selection of users) audiences.get(selection.applicationId)?.userIds.push(selection.id)
  return audiences
}
