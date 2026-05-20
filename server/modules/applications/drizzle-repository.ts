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
import type { ApplicationAggregate, ApplicationRepository, ConsentRecord } from './service'

type ApplicationRow = typeof application.$inferSelect
type OAuthClientRow = typeof oauthClient.$inferSelect
const corsOriginsMetadataKey = 'corsOrigins'
const customDataMetadataKey = 'customData'
const iconUrlMetadataKey = 'iconUrl'

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
        ...(patch.iconUrl !== undefined || patch.corsOrigins !== undefined || patch.customData !== undefined
          ? {
              metadata: writeApplicationMetadata(current.metadata, {
                iconUrl: patch.iconUrl,
                corsOrigins: patch.corsOrigins,
                customData: patch.customData,
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
          ? { postLogoutRedirectUris: serializeList(patch.postLogoutRedirectUris) }
          : {}),
        ...(patch.allowedGrantTypes !== undefined ? { grantTypes: serializeList(patch.allowedGrantTypes) } : {}),
        ...(patch.allowedScopes !== undefined ? { scopes: serializeList(patch.allowedScopes) } : {}),
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

function toApplicationInsert(input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>, now: Date) {
  return {
    id: input.id,
    oauthClientId: input.clientId,
    slug: input.slug,
    name: input.name,
    description: input.description,
    homepageUrl: input.homepageUrl,
    firstParty: input.firstParty,
    trusted: input.trusted,
    disabled: input.disabled,
    disabledReason: input.disabledReason,
    metadata: input.iconUrl ? { iconUrl: input.iconUrl } : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

function toOAuthClientInsert(
  input: Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>,
  clientSecret: string | null,
  now: Date,
) {
  return {
    id: `oauth_${crypto.randomUUID().replaceAll('-', '')}`,
    clientId: input.clientId,
    clientSecret,
    disabled: input.disabled,
    skipConsent: input.trusted,
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
    metadata: JSON.stringify({ applicationId: input.id }),
    createdAt: now,
    updatedAt: now,
  }
}

function toAggregate(app: ApplicationRow, client: OAuthClientRow): ApplicationAggregate {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    homepageUrl: app.homepageUrl,
    iconUrl: client.icon ?? readIconUrl(app.metadata),
    clientId: client.clientId,
    clientType: toClientType(client.type),
    public: client.public ?? false,
    firstParty: app.firstParty,
    trusted: app.trusted,
    disabled: app.disabled || !!client.disabled,
    disabledReason: app.disabledReason,
    redirectUris: parseList(client.redirectUris),
    postLogoutRedirectUris: parseList(client.postLogoutRedirectUris),
    corsOrigins: readCorsOrigins(app.metadata),
    customData: readCustomData(app.metadata),
    allowedGrantTypes: parseList(client.grantTypes).filter(isGrantType),
    allowedScopes: parseList(client.scopes).filter(isScope),
    requirePkce: client.requirePKCE ?? false,
    tokenEndpointAuthMethod: toTokenEndpointAuthMethod(client.tokenEndpointAuthMethod),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }
}

function toConsent(row: typeof applicationConsent.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    scopes: row.scopes.filter(isScope),
    grantedAt: row.grantedAt,
  }
}

function toPaginationMetadata(pagination: { limit: number; offset: number }, total: number) {
  const nextOffset = pagination.offset + pagination.limit < total ? pagination.offset + pagination.limit : null

  return {
    limit: pagination.limit,
    offset: pagination.offset,
    total,
    hasMore: nextOffset !== null,
    nextOffset,
  }
}

function serializeList(values: readonly string[]) {
  return JSON.stringify(values)
}

function parseList(value: string | null): string[] {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function readIconUrl(metadata: unknown) {
  return typeof metadata === 'object' &&
    metadata !== null &&
    iconUrlMetadataKey in metadata &&
    typeof metadata[iconUrlMetadataKey] === 'string'
    ? metadata[iconUrlMetadataKey]
    : null
}

function readCorsOrigins(metadata: unknown) {
  return readStringListMetadata(metadata, corsOriginsMetadataKey)
}

function readCustomData(metadata: unknown) {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    customDataMetadataKey in metadata &&
    typeof metadata[customDataMetadataKey] === 'object' &&
    metadata[customDataMetadataKey] !== null &&
    !Array.isArray(metadata[customDataMetadataKey])
  ) {
    return metadata[customDataMetadataKey] as Record<string, unknown>
  }
  return {}
}

function readStringListMetadata(metadata: unknown, key: string) {
  if (typeof metadata !== 'object' || metadata === null || !(key in metadata)) return []
  const value = (metadata as Record<string, unknown>)[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function writeApplicationMetadata(
  current: Record<string, unknown> | null,
  patch: {
    iconUrl?: string | null
    corsOrigins?: string[]
    customData?: Record<string, unknown>
  },
) {
  const next = { ...(current ?? {}) }
  if (patch.iconUrl !== undefined) {
    if (patch.iconUrl) next[iconUrlMetadataKey] = patch.iconUrl
    else delete next[iconUrlMetadataKey]
  }
  if (patch.corsOrigins !== undefined) next[corsOriginsMetadataKey] = patch.corsOrigins
  if (patch.customData !== undefined) next[customDataMetadataKey] = patch.customData
  return Object.keys(next).length ? next : null
}

function toClientType(value: string | null): ApplicationAggregate['clientType'] {
  if (value === 'public_spa' || value === 'public_native' || value === 'confidential_web') return value
  return 'confidential_web'
}

function toTokenEndpointAuthMethod(value: string | null): ApplicationAggregate['tokenEndpointAuthMethod'] {
  if (value === 'none' || value === 'client_secret_basic' || value === 'client_secret_post') return value
  return 'client_secret_basic'
}

function isGrantType(value: string): value is ApplicationAggregate['allowedGrantTypes'][number] {
  return value === 'authorization_code' || value === 'refresh_token' || value === 'client_credentials'
}

function isScope(value: string): value is ApplicationAggregate['allowedScopes'][number] {
  return value === 'openid' || value === 'profile' || value === 'email' || value === 'offline_access'
}
