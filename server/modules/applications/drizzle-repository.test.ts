import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import {
  application,
  applicationClientMetadata,
  applicationClientSecret,
  applicationConsent,
  oauthClient,
  oauthConsent,
} from '../../db/schema'
import { createDrizzleApplicationRepository } from './drizzle-repository'

describe('createDrizzleApplicationRepository', () => {
  it('creates application records without a D1 transaction', async () => {
    const db = new FakeDb()
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    const created = await repository.create({
      application: applicationInput(),
      clientSecret: {
        id: 'secret-1',
        version: 1,
        secretHash: 'hash-1',
        secretPrefix: 'fas_secret_',
        status: 'active',
        createdByUserId: 'admin-1',
      },
    })

    expect(created).toMatchObject({ id: 'app-1', clientId: 'client-1' })
    expect(db.inserts.map((insert) => insert.table)).toEqual([
      oauthClient,
      application,
      applicationClientMetadata,
      applicationClientSecret,
    ])
    expect(db.inserts[0]?.values).toMatchObject({ clientId: 'client-1', clientSecret: 'hash-1' })
    expect(db.inserts[3]?.values).toMatchObject({
      id: 'secret-1',
      applicationId: 'app-1',
      version: 1,
      materializedToOauthClientAt: expect.any(Date),
    })
  })

  it('updates application and OAuth client records without a D1 transaction', async () => {
    const db = new FakeDb({
      application: [{ id: 'app-1', oauthClientId: 'client-1' }],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.update('app-1', {
      name: 'Admin Console',
      homepageUrl: 'https://admin.example.com',
      iconUrl: 'https://admin.example.com/icon.png',
      trusted: true,
      disabled: true,
      redirectUris: ['https://admin.example.com/callback'],
      allowedGrantTypes: ['authorization_code'],
      allowedScopes: ['openid', 'profile'],
    })

    expect(db.updates).toHaveLength(2)
    expect(db.updates[0]).toMatchObject({
      table: application,
      set: {
        name: 'Admin Console',
        homepageUrl: 'https://admin.example.com',
        metadata: { iconUrl: 'https://admin.example.com/icon.png' },
        trusted: true,
        disabled: true,
        updatedAt: expect.any(Date),
      },
    })
    expect(db.updates[1]).toMatchObject({
      table: oauthClient,
      set: {
        name: 'Admin Console',
        uri: 'https://admin.example.com',
        icon: 'https://admin.example.com/icon.png',
        skipConsent: true,
        disabled: true,
        redirectUris: '["https://admin.example.com/callback"]',
        grantTypes: '["authorization_code"]',
        scopes: '["openid","profile"]',
        updatedAt: expect.any(Date),
      },
    })
  })

  it('deletes the OAuth client for an application without a D1 transaction', async () => {
    const db = new FakeDb({
      application: [{ id: 'app-1', oauthClientId: 'client-1' }],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.delete('app-1')

    expect(db.deletes).toEqual([{ table: oauthClient }])
  })

  it('rotates client secrets and materializes the active OAuth secret without a D1 transaction', async () => {
    const db = new FakeDb({
      application: [{ id: 'app-1', oauthClientId: 'client-1' }],
      applicationClientSecret: [{ version: 1 }],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    const secret = await repository.rotateSecret({
      applicationId: 'app-1',
      secret: {
        id: 'secret-2',
        version: 0,
        secretHash: 'hash-2',
        secretPrefix: 'fas_secret_2',
        status: 'active',
        createdByUserId: 'admin-2',
      },
    })

    expect(secret).toMatchObject({ id: 'secret-2', version: 2, revokedAt: null })
    expect(db.updates[0]).toMatchObject({
      table: applicationClientSecret,
      set: { status: 'revoked', revokedAt: expect.any(Date) },
    })
    expect(db.inserts[0]).toMatchObject({
      table: applicationClientSecret,
      values: {
        id: 'secret-2',
        applicationId: 'app-1',
        version: 2,
        materializedToOauthClientAt: expect.any(Date),
      },
    })
    expect(db.updates[1]).toMatchObject({
      table: oauthClient,
      set: { clientSecret: 'hash-2', updatedAt: expect.any(Date) },
    })
  })

  it('creates application and OAuth consent records without a D1 transaction', async () => {
    const db = new FakeDb()
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    const consent = await repository.createConsent({
      applicationId: 'app-1',
      clientId: 'client-1',
      userId: 'user-1',
      scopes: ['openid', 'profile'],
      permissions: ['contacts.read'],
    })

    expect(consent).toMatchObject({ scopes: ['openid', 'profile'], grantedAt: expect.any(Date) })
    expect(db.inserts).toHaveLength(2)
    expect(db.inserts[0]).toMatchObject({
      table: applicationConsent,
      values: {
        applicationId: 'app-1',
        userId: 'user-1',
        scopes: ['openid', 'profile'],
        permissions: ['contacts.read'],
        grantedAt: expect.any(Date),
      },
    })
    expect(db.inserts[1]).toMatchObject({
      table: oauthConsent,
      values: {
        clientId: 'client-1',
        userId: 'user-1',
        scopes: '["openid","profile"]',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    })
  })
})

function applicationInput() {
  return {
    id: 'app-1',
    slug: 'admin-console',
    name: 'Admin Console',
    description: null,
    homepageUrl: 'https://admin.example.com',
    iconUrl: null,
    clientId: 'client-1',
    clientType: 'confidential_web' as const,
    public: false,
    firstParty: false,
    trusted: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://admin.example.com/callback'],
    allowedGrantTypes: ['authorization_code' as const],
    allowedScopes: ['openid' as const],
    requirePkce: false,
    tokenEndpointAuthMethod: 'client_secret_basic' as const,
  }
}

class FakeDb {
  readonly inserts: Array<{ table: unknown; values: unknown }> = []
  readonly updates: Array<{ table: unknown; set: unknown }> = []
  readonly deletes: Array<{ table: unknown }> = []

  constructor(
    private readonly rows: {
      application?: unknown[]
      applicationClientSecret?: unknown[]
    } = {},
  ) {}

  insert(table: unknown) {
    return {
      values: async (values: unknown) => {
        this.inserts.push({ table, values })
      },
    }
  }

  update(table: unknown) {
    return {
      set: (set: unknown) => ({
        where: async () => {
          this.updates.push({ table, set })
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

  select() {
    return new FakeSelect(this.rows)
  }

  async transaction() {
    throw new Error('Unexpected D1 transaction')
  }

  async batch(statements: unknown[]) {
    return statements
  }
}

class FakeSelect {
  private table: unknown

  constructor(
    private readonly rows: {
      application?: unknown[]
      applicationClientSecret?: unknown[]
    },
  ) {}

  from(table: unknown) {
    this.table = table
    return this
  }

  where() {
    return this
  }

  orderBy() {
    return this
  }

  async limit(count: number) {
    return this.rowsForTable().slice(0, count)
  }

  private rowsForTable() {
    if (this.table === application) return this.rows.application ?? []
    if (this.table === applicationClientSecret) return this.rows.applicationClientSecret ?? []
    return []
  }
}
