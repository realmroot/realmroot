import type {
  CreateFederatedCredentialInput,
  FederatedCredentialRecord,
  OAuthClientRecord,
  ResolvedFederatedCredential,
  TokenExchangeRepository,
  UpdateFederatedCredentialInput,
} from '@server/usecases/ports'
import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  apiResource,
  application,
  federatedCredential,
  oauthAccessToken,
  oauthClient,
  tokenExchangeAccessToken,
} from '../../db/schema'

// Better Auth stores oauth_access_token.scopes as a JSON array string; older rows
// may use a space-delimited string. Normalize both to a string list.
function parseScopeList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
  }
  return trimmed ? trimmed.split(/\s+/) : []
}

type CredentialRow = typeof federatedCredential.$inferSelect

function toRecord(row: CredentialRow): FederatedCredentialRecord {
  return {
    id: row.id,
    applicationId: row.applicationId,
    name: row.name,
    issuer: row.issuer,
    subject: row.subject,
    audienceResourceId: row.audienceResourceId,
    jwksUrl: row.jwksUrl,
    publicKeys: row.publicKeys,
    enabled: row.enabled,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createTokenExchangeRepository(db: Database): TokenExchangeRepository {
  async function getCredential(applicationId: string, id: string): Promise<FederatedCredentialRecord | null> {
    const rows = await db
      .select()
      .from(federatedCredential)
      .where(and(eq(federatedCredential.id, id), eq(federatedCredential.applicationId, applicationId)))
      .limit(1)
    return rows[0] ? toRecord(rows[0]) : null
  }

  return {
    async findClient(clientId: string): Promise<OAuthClientRecord | null> {
      const rows = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1)
      return rows[0] ?? null
    },

    async findFederatedCredentials(
      applicationClientId: string,
      issuer: string,
    ): Promise<ResolvedFederatedCredential[]> {
      return db
        .select({
          id: federatedCredential.id,
          applicationId: federatedCredential.applicationId,
          applicationClientId: application.oauthClientId,
          name: federatedCredential.name,
          issuer: federatedCredential.issuer,
          subject: federatedCredential.subject,
          audience: apiResource.audience,
          jwksUrl: federatedCredential.jwksUrl,
          publicKeys: federatedCredential.publicKeys,
          sharedSecret: federatedCredential.sharedSecret,
          enabled: federatedCredential.enabled,
        })
        .from(federatedCredential)
        .innerJoin(application, eq(application.id, federatedCredential.applicationId))
        .innerJoin(apiResource, eq(apiResource.id, federatedCredential.audienceResourceId))
        .where(and(eq(application.oauthClientId, applicationClientId), eq(federatedCredential.issuer, issuer)))
    },

    async listFederatedCredentials(applicationId: string) {
      const rows = await db
        .select()
        .from(federatedCredential)
        .where(eq(federatedCredential.applicationId, applicationId))
        .orderBy(desc(federatedCredential.createdAt))
      return rows.map(toRecord)
    },

    getFederatedCredential(applicationId: string, id: string) {
      return getCredential(applicationId, id)
    },

    async createFederatedCredential(applicationId: string, input: CreateFederatedCredentialInput) {
      const now = new Date()
      const row: CredentialRow = {
        id: `fcr_${crypto.randomUUID().replaceAll('-', '')}`,
        applicationId,
        name: input.name,
        issuer: input.issuer,
        subject: input.subject,
        audienceResourceId: input.audienceResourceId,
        jwksUrl: input.jwksUrl ?? null,
        publicKeys: input.publicKeys ?? null,
        sharedSecret: null,
        enabled: true,
        metadata: input.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(federatedCredential).values(row)
      return toRecord(row)
    },

    async updateFederatedCredential(applicationId: string, id: string, input: UpdateFederatedCredentialInput) {
      const patch: Partial<CredentialRow> = { updatedAt: new Date() }
      if (input.name !== undefined) patch.name = input.name
      if (input.subject !== undefined) patch.subject = input.subject
      if (input.audienceResourceId !== undefined) patch.audienceResourceId = input.audienceResourceId
      if (input.jwksUrl !== undefined) patch.jwksUrl = input.jwksUrl
      if (input.publicKeys !== undefined) patch.publicKeys = input.publicKeys
      if (input.metadata !== undefined) patch.metadata = input.metadata
      if (input.enabled !== undefined) patch.enabled = input.enabled
      await db
        .update(federatedCredential)
        .set(patch)
        .where(and(eq(federatedCredential.id, id), eq(federatedCredential.applicationId, applicationId)))
      return getCredential(applicationId, id)
    },

    async deleteFederatedCredential(applicationId: string, id: string) {
      const existing = await getCredential(applicationId, id)
      if (!existing) return false
      await db
        .delete(federatedCredential)
        .where(and(eq(federatedCredential.id, id), eq(federatedCredential.applicationId, applicationId)))
      return true
    },

    async storeAccessToken(input) {
      await db.insert(tokenExchangeAccessToken).values(input)
    },

    async findAccessTokenByHash(tokenHash: string) {
      const rows = await db
        .select()
        .from(tokenExchangeAccessToken)
        .where(eq(tokenExchangeAccessToken.tokenHash, tokenHash))
        .limit(1)
      return rows[0] ?? null
    },

    async findOAuthAccessTokenByHash(tokenHash: string) {
      const rows = await db
        .select({
          clientId: oauthAccessToken.clientId,
          userId: oauthAccessToken.userId,
          scopes: oauthAccessToken.scopes,
          expiresAt: oauthAccessToken.expiresAt,
          createdAt: oauthAccessToken.createdAt,
        })
        .from(oauthAccessToken)
        .where(eq(oauthAccessToken.token, tokenHash))
        .limit(1)
      const row = rows[0]
      if (!row) return null
      return {
        clientId: row.clientId,
        userId: row.userId ?? null,
        scopes: parseScopeList(row.scopes),
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      }
    },
  }
}
