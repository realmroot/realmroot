import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import { identityProviderConnector } from '../../db/schema'
import { createConnectorRepository } from './repository'

describe('createConnectorRepository', () => {
  it('lists and finds connector rows', async () => {
    const db = new FakeDb([connectorRow()])
    const repository = createConnectorRepository(db as unknown as Database)

    await expect(repository.list({ limit: 10, offset: 0 })).resolves.toEqual({
      items: [connectorRow()],
      total: 1,
    })
    await expect(repository.listEnabled()).resolves.toEqual([connectorRow()])
    await expect(repository.findById('connector-1')).resolves.toEqual(connectorRow())
    await expect(repository.findByProviderId('google')).resolves.toEqual(connectorRow())
    await expect(createConnectorRepository(new FakeDb() as unknown as Database).findById('missing')).resolves.toBeNull()
  })

  it('creates, updates, and deletes connector rows', async () => {
    const db = new FakeDb([connectorRow()])
    const repository = createConnectorRepository(db as unknown as Database)

    await expect(repository.create(connectorRow())).resolves.toEqual(connectorRow())
    await expect(repository.update('connector-1', { enabled: false })).resolves.toEqual(connectorRow())
    await expect(
      createConnectorRepository(new FakeDb() as unknown as Database).update('missing', { enabled: false }),
    ).resolves.toBeNull()
    await repository.delete('connector-1')

    expect(db.inserts).toEqual([{ table: identityProviderConnector, values: connectorRow() }])
    expect(db.updates).toEqual([{ table: identityProviderConnector, set: { enabled: false } }])
    expect(db.deletes).toEqual([{ table: identityProviderConnector }])
  })
})

class FakeDb {
  readonly inserts: Array<{ table: unknown; values: unknown }> = []
  readonly updates: Array<{ table: unknown; set: unknown }> = []
  readonly deletes: Array<{ table: unknown }> = []

  constructor(private readonly rows: unknown[] = []) {}

  select(fields?: unknown) {
    return new FakeSelect(this.rows, fields)
  }

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        this.inserts.push({ table, values })
        return { returning: async () => this.rows }
      },
    }
  }

  update(table: unknown) {
    return {
      set: (set: unknown) => ({
        where: () => {
          this.updates.push({ table, set })
          return { returning: async () => this.rows }
        },
      }),
    }
  }

  delete(table: unknown) {
    return {
      where: async () => {
        this.deletes.push({ table })
      },
    }
  }
}

class FakeSelect {
  constructor(
    private readonly rows: unknown[],
    private readonly fields?: unknown,
  ) {}

  from() {
    return this
  }

  orderBy() {
    return this
  }

  limit() {
    return this
  }

  offset() {
    return this
  }

  where() {
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable, and this fake mirrors that contract.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    const rows =
      this.fields && typeof this.fields === 'object' && 'value' in this.fields
        ? [{ value: this.rows.length }]
        : this.rows
    return Promise.resolve(rows).then(onfulfilled, onrejected)
  }
}

function connectorRow() {
  return {
    id: 'connector-1',
    providerId: 'google',
    providerType: 'social' as const,
    slug: 'google',
    displayName: 'Google',
    enabled: true,
    clientId: 'google-client',
    clientSecretBinding: 'GOOGLE_SECRET',
    issuer: 'https://accounts.google.com',
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    scopes: ['openid', 'email'],
    attributeMapping: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}
