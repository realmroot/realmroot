import type { IdentifierGenerator } from '@server/usecases/identifier-generator'
import type {
  CreateFederatedCredentialInput,
  FederatedCredentialRecord,
  OAuthClientRecord,
  ResolvedFederatedCredential,
  TokenExchangeRepository,
  UpdateFederatedCredentialInput,
} from '@server/usecases/ports'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client'
import {
  apiResource,
  application,
  federatedCredential,
  oauthClient,
  tokenExchangeAccessToken,
  tokenExchangeRefreshToken,
} from '../../db/schema'

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

export function createTokenExchangeRepository(db: Database, ids: IdentifierGenerator): TokenExchangeRepository {
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
          ownerOrganizationId: application.ownerOrganizationId,
          name: federatedCredential.name,
          issuer: federatedCredential.issuer,
          subject: federatedCredential.subject,
          audience: apiResource.resourceUrl,
          jwksUrl: federatedCredential.jwksUrl,
          publicKeys: federatedCredential.publicKeys,
          enabled: federatedCredential.enabled,
        })
        .from(federatedCredential)
        .innerJoin(application, eq(application.id, federatedCredential.applicationId))
        .innerJoin(apiResource, eq(apiResource.id, federatedCredential.audienceResourceId))
        .where(
          and(
            eq(application.oauthClientId, applicationClientId),
            eq(federatedCredential.issuer, issuer),
            eq(application.disabled, false),
            eq(apiResource.enabled, true),
            eq(federatedCredential.enabled, true),
          ),
        )
    },

    async findFederatedCredentialForClient(id, clientId) {
      const [row] = await resolvedCredentialQuery(db).where(
        and(
          eq(federatedCredential.id, id),
          eq(application.oauthClientId, clientId),
          eq(application.disabled, false),
          eq(apiResource.enabled, true),
          eq(federatedCredential.enabled, true),
        ),
      )
      return row ?? null
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
        id: ids.generate(),
        applicationId,
        name: input.name,
        issuer: input.issuer,
        subject: input.subject,
        audienceResourceId: input.audienceResourceId,
        jwksUrl: input.jwksUrl ?? null,
        publicKeys: input.publicKeys ?? null,
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

    async storeRefreshToken(input) {
      await db.insert(tokenExchangeRefreshToken).values(input)
      const [revokedFamily] = await db
        .select({ id: tokenExchangeRefreshToken.id })
        .from(tokenExchangeRefreshToken)
        .where(
          and(eq(tokenExchangeRefreshToken.familyId, input.familyId), isNotNull(tokenExchangeRefreshToken.revokedAt)),
        )
        .limit(1)
      if (!revokedFamily) return true
      await db
        .update(tokenExchangeRefreshToken)
        .set({ revokedAt: new Date() })
        .where(eq(tokenExchangeRefreshToken.id, input.id))
      return false
    },

    async findRefreshTokenByHash(tokenHash) {
      const [row] = await db
        .select()
        .from(tokenExchangeRefreshToken)
        .where(eq(tokenExchangeRefreshToken.tokenHash, tokenHash))
        .limit(1)
      return row ?? null
    },

    async consumeRefreshToken(id, now) {
      const [row] = await db
        .update(tokenExchangeRefreshToken)
        .set({ consumedAt: now })
        .where(
          and(
            eq(tokenExchangeRefreshToken.id, id),
            isNull(tokenExchangeRefreshToken.consumedAt),
            isNull(tokenExchangeRefreshToken.revokedAt),
          ),
        )
        .returning({ id: tokenExchangeRefreshToken.id })
      return Boolean(row)
    },

    async revokeRefreshTokenFamily(familyId, now) {
      await db
        .update(tokenExchangeRefreshToken)
        .set({ revokedAt: now })
        .where(and(eq(tokenExchangeRefreshToken.familyId, familyId), isNull(tokenExchangeRefreshToken.revokedAt)))
    },
  }
}

function resolvedCredentialQuery(db: Database) {
  return db
    .select({
      id: federatedCredential.id,
      applicationId: federatedCredential.applicationId,
      applicationClientId: application.oauthClientId,
      ownerOrganizationId: application.ownerOrganizationId,
      name: federatedCredential.name,
      issuer: federatedCredential.issuer,
      subject: federatedCredential.subject,
      audience: apiResource.resourceUrl,
      jwksUrl: federatedCredential.jwksUrl,
      publicKeys: federatedCredential.publicKeys,
      enabled: federatedCredential.enabled,
    })
    .from(federatedCredential)
    .innerJoin(application, eq(application.id, federatedCredential.applicationId))
    .innerJoin(apiResource, eq(apiResource.id, federatedCredential.audienceResourceId))
}
