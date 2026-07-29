import type { ConnectorRepository, SecretCipher } from '@server/usecases/ports'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { identityProviderConnector } from '../../db/schema'

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

    async create(input) {
      const [row] = await db
        .insert(identityProviderConnector)
        .values({
          ...input,
          clientSecret: input.clientSecret
            ? await secrets.seal(input.clientSecret, connectorSecretContext(input.id))
            : input.clientSecret,
        })
        .returning()
      return decryptConnector(db, row, secrets)
    },

    async update(id, input) {
      const encryptedInput =
        typeof input.clientSecret === 'string'
          ? { ...input, clientSecret: await secrets.seal(input.clientSecret, connectorSecretContext(id)) }
          : input
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
  return {
    ...row,
    clientSecret,
  }
}

async function readConnectorSecret(db: Database, row: ConnectorRow, secrets: SecretCipher) {
  if (!row.clientSecret) return null
  const context = connectorSecretContext(row.id)
  if (secrets.isSealed(row.clientSecret)) return secrets.open(row.clientSecret, context)

  const encrypted = await secrets.seal(row.clientSecret, context)
  await db
    .update(identityProviderConnector)
    .set({ clientSecret: encrypted })
    .where(and(eq(identityProviderConnector.id, row.id), eq(identityProviderConnector.clientSecret, row.clientSecret)))
  return row.clientSecret
}

function connectorSecretContext(connectorId: string) {
  return `connector:${connectorId}:client-secret`
}
