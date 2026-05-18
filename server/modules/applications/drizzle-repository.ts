import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  oauthClient,
  oauthConsent,
} from '../../db/schema'
import type { ApplicationAggregate, ApplicationRepository, ConsentRecord } from './service'

type ApplicationRow = typeof application.$inferSelect
type OAuthClientRow = typeof oauthClient.$inferSelect

export function createDrizzleApplicationRepository(db: Database): ApplicationRepository {
  return {
    async create(input) {
      const now = new Date()
      await db.transaction(async (tx) => {
        await tx
          .insert(oauthClient)
          .values(toOAuthClientInsert(input.application, input.clientSecret?.secretHash ?? null, now))
        await tx.insert(application).values(toApplicationInsert(input.application, now))
        await tx.insert(applicationClientMetadata).values({
          applicationId: input.application.id,
        })
        if (input.clientSecret) {
          await tx.insert(applicationClientSecret).values({
            ...input.clientSecret,
            applicationId: input.application.id,
            materializedToOauthClientAt: now,
          })
        }
      })
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
      await db.transaction(async (tx) => {
        const applicationPatch = {
          ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.homepageUrl !== undefined ? { homepageUrl: patch.homepageUrl } : {}),
          ...(patch.iconUrl !== undefined ? { metadata: { iconUrl: patch.iconUrl } } : {}),
          ...(patch.firstParty !== undefined ? { firstParty: patch.firstParty } : {}),
          ...(patch.trusted !== undefined ? { trusted: patch.trusted } : {}),
          ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
          ...(patch.disabledReason !== undefined ? { disabledReason: patch.disabledReason } : {}),
          updatedAt: now,
        }
        await tx.update(application).set(applicationPatch).where(eq(application.id, id))

        const currentRows = await tx.select().from(application).where(eq(application.id, id)).limit(1)
        const current = currentRows[0]
        if (!current) return

        const oauthPatch = {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.homepageUrl !== undefined ? { uri: patch.homepageUrl } : {}),
          ...(patch.iconUrl !== undefined ? { icon: patch.iconUrl } : {}),
          ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
          ...(patch.trusted !== undefined ? { skipConsent: patch.trusted } : {}),
          ...(patch.redirectUris !== undefined ? { redirectUris: serializeList(patch.redirectUris) } : {}),
          ...(patch.allowedGrantTypes !== undefined ? { grantTypes: serializeList(patch.allowedGrantTypes) } : {}),
          ...(patch.allowedScopes !== undefined ? { scopes: serializeList(patch.allowedScopes) } : {}),
          updatedAt: now,
        }
        await tx.update(oauthClient).set(oauthPatch).where(eq(oauthClient.clientId, current.oauthClientId))
      })
    },

    async delete(id) {
      await db.transaction(async (tx) => {
        const rows = await tx.select().from(application).where(eq(application.id, id)).limit(1)
        const app = rows[0]
        if (app) {
          await tx.delete(oauthClient).where(eq(oauthClient.clientId, app.oauthClientId))
        }
      })
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
      const version = await db.transaction(async (tx) => {
        const versions = await tx
          .select({ version: applicationClientSecret.version })
          .from(applicationClientSecret)
          .where(eq(applicationClientSecret.applicationId, input.applicationId))
          .orderBy(desc(applicationClientSecret.version))
          .limit(1)
        const nextVersion = (versions[0]?.version ?? 0) + 1

        const rows = await tx.select().from(application).where(eq(application.id, input.applicationId)).limit(1)
        const app = rows[0]
        if (!app) return nextVersion

        await tx
          .update(applicationClientSecret)
          .set({ status: 'revoked', revokedAt: now })
          .where(
            and(
              eq(applicationClientSecret.applicationId, input.applicationId),
              eq(applicationClientSecret.status, 'active'),
            ),
          )
        await tx.insert(applicationClientSecret).values({
          ...input.secret,
          version: nextVersion,
          applicationId: input.applicationId,
          materializedToOauthClientAt: now,
        })
        await tx
          .update(oauthClient)
          .set({ clientSecret: input.secret.secretHash, updatedAt: now })
          .where(eq(oauthClient.clientId, app.oauthClientId))
        return nextVersion
      })

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

    async createConsent(input) {
      const now = new Date()
      const id = `consent_${crypto.randomUUID().replaceAll('-', '')}`
      await db.transaction(async (tx) => {
        await tx.insert(applicationConsent).values({
          id,
          applicationId: input.applicationId,
          userId: input.userId,
          scopes: input.scopes,
          permissions: input.permissions,
          grantedAt: now,
        })
        await tx.insert(oauthConsent).values({
          id: `oauthconsent_${crypto.randomUUID().replaceAll('-', '')}`,
          clientId: input.clientId,
          userId: input.userId,
          scopes: serializeList(input.scopes),
          createdAt: now,
          updatedAt: now,
        })
      })

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
    'iconUrl' in metadata &&
    typeof metadata.iconUrl === 'string'
    ? metadata.iconUrl
    : null
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
