import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import type { ApplicationRepository } from '@server/usecases/ports'
import { and, count, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  apiResource,
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  user,
} from '../../db/schema'
import {
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

export function createDrizzleApplicationRepository(db: Database, ids: IdentifierGenerator): ApplicationRepository {
  return {
    async create(input) {
      const now = new Date()
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db
          .insert(oauthClient)
          .values(toOAuthClientInsert(input.application, input.clientSecret?.secretHash ?? null, now, ids.generate())),
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
      return {
        items: rows.map((row) => toAggregate(row.application, row.oauthClient)),
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
      return toAggregate(row.application, row.oauthClient)
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
      return toAggregate(row.application, row.oauthClient)
    },

    async update(id, patch) {
      const now = new Date()
      const currentRows = await db.select().from(application).where(eq(application.id, id)).limit(1)
      const current = currentRows[0]
      if (!current) return 'application_not_found'

      const applicationPatch = {
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.homepageUrl !== undefined ? { homepageUrl: patch.homepageUrl } : {}),
        ...(patch.ownerOrganizationId !== undefined ? { ownerOrganizationId: patch.ownerOrganizationId } : {}),
        ...(patch.oidcScopes !== undefined ? { oidcScopes: patch.oidcScopes } : {}),
        ...(patch.resourceScopes !== undefined ? { resourceScopes: patch.resourceScopes } : {}),
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
        ...(patch.oidcScopes !== undefined || patch.resourceScopes !== undefined
          ? {
              scopes: serializeList([
                ...(patch.oidcScopes ?? current.oidcScopes),
                ...new Set((patch.resourceScopes ?? current.resourceScopes).flatMap((resource) => resource.scopes)),
              ]),
            }
          : {}),
        ...(patch.oidcClaims !== undefined
          ? { metadata: JSON.stringify({ applicationId: id, oidcClaims: patch.oidcClaims }) }
          : {}),
        updatedAt: now,
      }
      const activeResourceCondition = patch.resourceScopes?.length
        ? sql`not exists (
            select 1
            from json_each(${JSON.stringify(patch.resourceScopes)}) as requested_resource
            left join ${apiResource}
              on ${apiResource.id} = json_extract(requested_resource.value, '$.resourceServerId')
            where ${apiResource.id} is null
              or ${apiResource.enabled} <> 1
              or ${apiResource.deletedAt} is not null
          )`
        : undefined
      const statements: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
        db
          .update(application)
          .set(applicationPatch)
          .where(and(eq(application.id, id), activeResourceCondition))
          .returning({ id: application.id }),
        db
          .update(oauthClient)
          .set(oauthPatch)
          .where(and(eq(oauthClient.clientId, current.oauthClientId), activeResourceCondition)),
      ]
      const [updated] = await db.batch(statements)
      if (updated.length > 0) return 'updated'
      const [remaining] = await db
        .select({ id: application.id })
        .from(application)
        .where(eq(application.id, id))
        .limit(1)
      return remaining ? 'resource_inactive' : 'application_not_found'
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
        query.userId ? eq(applicationConsent.userId, query.userId) : undefined,
        ownerOrganizationIds ? inArray(application.ownerOrganizationId, ownerOrganizationIds) : undefined,
        statusCondition,
      )
      const rows = await db
        .select({
          id: applicationConsent.id,
          applicationId: applicationConsent.applicationId,
          applicationName: application.name,
          applicationSlug: application.slug,
          userId: user.id,
          userDisplayName: user.name,
          userEmail: user.email,
          scopes: applicationConsent.scopes,
          resourceServerId: applicationConsent.resourceServerId,
          grantedAt: applicationConsent.grantedAt,
          expiresAt: applicationConsent.expiresAt,
          revokedAt: applicationConsent.revokedAt,
        })
        .from(applicationConsent)
        .innerJoin(application, eq(applicationConsent.applicationId, application.id))
        .innerJoin(user, eq(applicationConsent.userId, user.id))
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
        items: rows,
        pagination: toPaginationMetadata(query, totalRows[0]?.total ?? 0),
      }
    },

    async findAuthorization(authorizationId) {
      const [row] = await db
        .select({
          id: applicationConsent.id,
          applicationId: applicationConsent.applicationId,
          applicationName: application.name,
          applicationSlug: application.slug,
          userId: user.id,
          userDisplayName: user.name,
          userEmail: user.email,
          scopes: applicationConsent.scopes,
          resourceServerId: applicationConsent.resourceServerId,
          grantedAt: applicationConsent.grantedAt,
          expiresAt: applicationConsent.expiresAt,
          revokedAt: applicationConsent.revokedAt,
        })
        .from(applicationConsent)
        .innerJoin(application, eq(applicationConsent.applicationId, application.id))
        .innerJoin(user, eq(applicationConsent.userId, user.id))
        .where(eq(applicationConsent.id, authorizationId))
        .limit(1)
      return row ?? null
    },

    async revokeAuthorization(authorizationId) {
      const row = await findAuthorizationGrant(db, { authorizationId })
      if (!row) return false
      await revokeAuthorizationGrant(db, row)
      return true
    },

    async findConsent(applicationId, userId, resourceServerId) {
      const rows = await db
        .select()
        .from(applicationConsent)
        .where(
          and(
            eq(applicationConsent.applicationId, applicationId),
            eq(applicationConsent.userId, userId),
            resourceServerId === null
              ? isNull(applicationConsent.resourceServerId)
              : eq(applicationConsent.resourceServerId, resourceServerId),
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
              input.resourceServerId === null
                ? isNull(applicationConsent.resourceServerId)
                : eq(applicationConsent.resourceServerId, input.resourceServerId),
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
              input.resourceServerId === null
                ? isNull(oauthConsent.referenceId)
                : eq(oauthConsent.referenceId, input.resourceServerId),
            ),
          )
          .limit(1),
      ])
      const id = existingApplicationConsent[0]?.id ?? ids.generate()
      const applicationStatement = existingApplicationConsent[0]
        ? db
            .update(applicationConsent)
            .set({ scopes: input.scopes, grantedAt: now, expiresAt: null })
            .where(eq(applicationConsent.id, id))
        : db.insert(applicationConsent).values({
            id,
            applicationId: input.applicationId,
            userId: input.userId,
            resourceServerId: input.resourceServerId,
            scopes: input.scopes,
            grantedAt: now,
          })
      const oauthStatement = existingOAuthConsent[0]
        ? db
            .update(oauthConsent)
            .set({ scopes: serializeList(input.scopes), updatedAt: now })
            .where(eq(oauthConsent.id, existingOAuthConsent[0].id))
        : db.insert(oauthConsent).values({
            id: ids.generate(),
            clientId: input.clientId,
            userId: input.userId,
            scopes: serializeList(input.scopes),
            referenceId: input.resourceServerId,
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
            input.resourceServerId === null
              ? isNull(applicationConsent.resourceServerId)
              : eq(applicationConsent.resourceServerId, input.resourceServerId),
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
