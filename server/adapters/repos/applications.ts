import type { ApplicationRepository } from '@server/usecases/ports'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Database } from '../../db/client'
import {
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
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
const _systemManagedMetadataKey = 'systemManaged'

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
      await db.batch(statements)
      return {
        ...input.application,
        createdAt: now,
        updatedAt: now,
      }
    },

    async upsertSystem(input) {
      const now = new Date()
      await db.batch([
        db
          .insert(oauthClient)
          .values(toOAuthClientInsert(input, null, now))
          .onConflictDoUpdate({
            target: oauthClient.clientId,
            set: {
              clientSecret: null,
              disabled: input.disabled,
              skipConsent: input.trusted,
              enableEndSession: true,
              name: input.name,
              uri: input.homepageUrl,
              icon: input.iconUrl,
              redirectUris: serializeList(input.redirectUris),
              postLogoutRedirectUris: serializeList(input.postLogoutRedirectUris),
              tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
              grantTypes: serializeList(input.allowedGrantTypes),
              responseTypes: serializeList(['code']),
              public: input.public,
              type: input.clientType,
              requirePKCE: input.requirePkce,
              scopes: serializeList(input.allowedScopes),
              metadata: JSON.stringify({ applicationId: input.id, oidcClaims: input.oidcClaims }),
              updatedAt: now,
            },
          }),
        db
          .insert(application)
          .values(toApplicationInsert(input, now))
          .onConflictDoUpdate({
            target: application.id,
            set: {
              oauthClientId: input.clientId,
              slug: input.slug,
              name: input.name,
              description: input.description,
              homepageUrl: input.homepageUrl,
              firstParty: input.firstParty,
              trusted: input.trusted,
              disabled: input.disabled,
              disabledReason: input.disabledReason,
              metadata: writeApplicationMetadata(null, {
                iconUrl: input.iconUrl,
                corsOrigins: input.corsOrigins,
                customData: input.customData,
                oidcClaims: input.oidcClaims,
                systemManaged: input.systemManaged,
              }),
              updatedAt: now,
            },
          }),
        db.insert(applicationClientMetadata).values({ applicationId: input.id }).onConflictDoNothing(),
      ])
      return {
        ...input,
        createdAt: now,
        updatedAt: now,
      }
    },

    async list(pagination) {
      const rows = await db
        .select({ application, oauthClient })
        .from(application)
        .innerJoin(oauthClient, eq(application.oauthClientId, oauthClient.clientId))
        .orderBy(desc(application.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset)
      const totalRows = await db.select({ total: count() }).from(application)
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
      return row ? toAggregate(row.application, row.oauthClient) : null
    },

    async findByClientId(clientId) {
      const rows = await db
        .select({ application, oauthClient })
        .from(application)
        .innerJoin(oauthClient, eq(application.oauthClientId, oauthClient.clientId))
        .where(eq(oauthClient.clientId, clientId))
        .limit(1)
      const row = rows[0]
      return row ? toAggregate(row.application, row.oauthClient) : null
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
      await db.batch([
        db.update(application).set(applicationPatch).where(eq(application.id, id)),
        db.update(oauthClient).set(oauthPatch).where(eq(oauthClient.clientId, current.oauthClientId)),
      ])
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
      const [row] = await db
        .select({
          applicationId: applicationConsent.applicationId,
          clientId: application.oauthClientId,
        })
        .from(applicationConsent)
        .innerJoin(application, eq(applicationConsent.applicationId, application.id))
        .where(
          and(
            eq(applicationConsent.id, consentId),
            eq(applicationConsent.userId, userId),
            isNull(applicationConsent.revokedAt),
          ),
        )
        .limit(1)

      if (!row) {
        return false
      }

      const now = new Date()
      await db.batch([
        db
          .update(applicationConsent)
          .set({ revokedAt: now })
          .where(
            and(
              eq(applicationConsent.applicationId, row.applicationId),
              eq(applicationConsent.userId, userId),
              isNull(applicationConsent.revokedAt),
            ),
          ),
        db.delete(oauthConsent).where(and(eq(oauthConsent.clientId, row.clientId), eq(oauthConsent.userId, userId))),
        db
          .delete(oauthAccessToken)
          .where(and(eq(oauthAccessToken.clientId, row.clientId), eq(oauthAccessToken.userId, userId))),
        db
          .update(oauthRefreshToken)
          .set({ revoked: now })
          .where(
            and(
              eq(oauthRefreshToken.clientId, row.clientId),
              eq(oauthRefreshToken.userId, userId),
              isNull(oauthRefreshToken.revoked),
            ),
          ),
      ])
      return true
    },

    async createConsent(input) {
      const now = new Date()
      const id = `consent_${crypto.randomUUID().replaceAll('-', '')}`
      await db.batch([
        db.insert(applicationConsent).values({
          id,
          applicationId: input.applicationId,
          userId: input.userId,
          scopes: input.scopes,
          permissions: input.permissions,
          grantedAt: now,
        }),
        db.insert(oauthConsent).values({
          id: `oauthconsent_${crypto.randomUUID().replaceAll('-', '')}`,
          clientId: input.clientId,
          userId: input.userId,
          scopes: serializeList(input.scopes),
          createdAt: now,
          updatedAt: now,
        }),
      ])

      return {
        id,
        scopes: input.scopes,
        grantedAt: now,
      }
    },
  }
}
