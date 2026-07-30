import type { ConnectorRepository, SecretCipher } from '@server/usecases/ports'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { apiResource, identityProviderConnector } from '../../db/schema'

export type ConnectorRow = typeof identityProviderConnector.$inferSelect
export type ConnectorInsert = typeof identityProviderConnector.$inferInsert

export function createConnectorRepository(db: Database, secrets: SecretCipher): ConnectorRepository {
  return {
    async list(page) {
      const rows = await db
        .select()
        .from(identityProviderConnector)
        .orderBy(desc(identityProviderConnector.createdAt))
        .limit(page.limit)
        .offset(page.offset)
      const [total] = await db.select({ value: count() }).from(identityProviderConnector)

      return {
        items: await Promise.all(rows.map((row) => decryptConnector(db, row, secrets))),
        total: total?.value ?? 0,
      }
    },

    async listEnabled() {
      const rows = await db.select().from(identityProviderConnector).where(eq(identityProviderConnector.enabled, true))
      return Promise.all(rows.map((row) => decryptConnector(db, row, secrets)))
    },

    async findById(id) {
      const [row] = await db.select().from(identityProviderConnector).where(eq(identityProviderConnector.id, id))
      return row ? decryptConnector(db, row, secrets) : null
    },

    async findByProviderId(providerId) {
      const [row] = await db
        .select()
        .from(identityProviderConnector)
        .where(eq(identityProviderConnector.providerId, providerId))
      return row ? decryptConnector(db, row, secrets) : null
    },

    async countResourceReferences(id) {
      const [result] = await db
        .select({ value: count() })
        .from(apiResource)
        .where(eq(apiResource.authorizationConnectorId, id))
      return result?.value ?? 0
    },

    async create(input) {
      const clientSecretContext = input.clientSecret ? connectorSecretContext(input.id) : null
      const registrationAccessTokenContext = input.registrationAccessToken
        ? connectorRegistrationTokenContext(input.id)
        : null
      const [row] = await db
        .insert(identityProviderConnector)
        .values({
          ...input,
          clientSecret: input.clientSecret
            ? await secrets.seal(input.clientSecret, clientSecretContext!)
            : input.clientSecret,
          clientSecretContext,
          registrationAccessToken: input.registrationAccessToken
            ? await secrets.seal(input.registrationAccessToken, registrationAccessTokenContext!)
            : input.registrationAccessToken,
          registrationAccessTokenContext,
        })
        .returning()
      return decryptConnector(db, row, secrets)
    },

    async update(id, input) {
      const encryptedInput = { ...input }
      if (typeof input.clientSecret === 'string') {
        encryptedInput.clientSecretContext = connectorSecretContext(id)
        encryptedInput.clientSecret = await secrets.seal(input.clientSecret, encryptedInput.clientSecretContext)
      }
      if (typeof input.registrationAccessToken === 'string') {
        encryptedInput.registrationAccessTokenContext = connectorRegistrationTokenContext(id)
        encryptedInput.registrationAccessToken = await secrets.seal(
          input.registrationAccessToken,
          encryptedInput.registrationAccessTokenContext,
        )
      }
      const [row] = await db
        .update(identityProviderConnector)
        .set(encryptedInput)
        .where(eq(identityProviderConnector.id, id))
        .returning()
      return row ? decryptConnector(db, row, secrets) : null
    },

    async delete(id) {
      await db.delete(identityProviderConnector).where(eq(identityProviderConnector.id, id))
    },
  }
}

async function decryptConnector(db: Database, row: ConnectorRow, secrets: SecretCipher): Promise<ConnectorRow> {
  const clientSecret = await readConnectorSecret(db, row, secrets)
  const registrationAccessToken = row.registrationAccessToken
    ? await secrets.open(
        row.registrationAccessToken,
        row.registrationAccessTokenContext ?? connectorRegistrationTokenContext(row.id),
      )
    : null
  return {
    ...row,
    clientSecret,
    registrationAccessToken,
  }
}

async function readConnectorSecret(db: Database, row: ConnectorRow, secrets: SecretCipher) {
  if (!row.clientSecret) return null
  const context = row.clientSecretContext ?? connectorSecretContext(row.id)
  if (secrets.isSealed(row.clientSecret)) return secrets.open(row.clientSecret, context)

  const encrypted = await secrets.seal(row.clientSecret, context)
  await db
    .update(identityProviderConnector)
    .set({ clientSecret: encrypted, clientSecretContext: context })
    .where(and(eq(identityProviderConnector.id, row.id), eq(identityProviderConnector.clientSecret, row.clientSecret)))
  return row.clientSecret
}

function connectorSecretContext(connectorId: string) {
  return `connector:${connectorId}:client-secret`
}

function connectorRegistrationTokenContext(connectorId: string) {
  return `connector:${connectorId}:registration-token`
}
