import type { OAuthClientRecord, TokenExchangeRepository } from '@server/usecases/ports'
import { desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { oauthClient, tokenExchangeAccessToken, trustedExternalIssuer } from '../../db/schema'

export function createTokenExchangeRepository(db: Database): TokenExchangeRepository {
  return {
    async findClient(clientId: string): Promise<OAuthClientRecord | null> {
      const rows = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1)
      return rows[0] ?? null
    },

    async findTrustedIssuer(issuer: string) {
      const rows = await db
        .select()
        .from(trustedExternalIssuer)
        .where(eq(trustedExternalIssuer.issuer, issuer))
        .limit(1)
      return rows[0] ?? null
    },

    async createTrustedIssuer(input) {
      const now = new Date()
      const row = {
        id: `tei_${crypto.randomUUID().replaceAll('-', '')}`,
        issuer: input.issuer,
        name: input.name,
        jwksUrl: input.jwksUrl ?? null,
        sharedSecret: input.sharedSecret ?? null,
        allowedAudiences: input.allowedAudiences ?? null,
        enabled: true,
        metadata: input.metadata ?? null,
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(trustedExternalIssuer).values(row)
      return row
    },

    async listTrustedIssuers() {
      return db.select().from(trustedExternalIssuer).orderBy(desc(trustedExternalIssuer.createdAt))
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
  }
}
