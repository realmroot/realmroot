import type { ConnectorRepository } from '@server/usecases/ports'
import { count, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { identityProviderConnector } from '../../db/schema'

export type ConnectorRow = typeof identityProviderConnector.$inferSelect
export type ConnectorInsert = typeof identityProviderConnector.$inferInsert

export function createConnectorRepository(db: Database): ConnectorRepository {
  return {
    async list(page) {
      const items = await db
        .select()
        .from(identityProviderConnector)
        .orderBy(desc(identityProviderConnector.createdAt))
        .limit(page.limit)
        .offset(page.offset)
      const [total] = await db.select({ value: count() }).from(identityProviderConnector)

      return { items, total: total?.value ?? 0 }
    },

    async listEnabled() {
      return db.select().from(identityProviderConnector).where(eq(identityProviderConnector.enabled, true))
    },

    async findById(id) {
      const [row] = await db.select().from(identityProviderConnector).where(eq(identityProviderConnector.id, id))
      return row ?? null
    },

    async findByProviderId(providerId) {
      const [row] = await db
        .select()
        .from(identityProviderConnector)
        .where(eq(identityProviderConnector.providerId, providerId))
      return row ?? null
    },

    async create(input) {
      const [row] = await db.insert(identityProviderConnector).values(input).returning()
      return row
    },

    async update(id, input) {
      const [row] = await db
        .update(identityProviderConnector)
        .set(input)
        .where(eq(identityProviderConnector.id, id))
        .returning()
      return row ?? null
    },

    async delete(id) {
      await db.delete(identityProviderConnector).where(eq(identityProviderConnector.id, id))
    },
  }
}
