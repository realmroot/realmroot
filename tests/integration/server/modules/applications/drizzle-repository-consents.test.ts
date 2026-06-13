import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import type { Database } from '@server/db/client'
import { application, applicationClientSecret, applicationConsent, oauthClient } from '@server/db/schema'
import { describe, expect, it } from 'vitest'

describe('drizzle-repository.test 3', () => {
  it('merges application metadata fields across independent updates', async () => {
    const db = new FakeDb({
      application: [
        {
          id: 'app-1',
          oauthClientId: 'client-1',
          metadata: {
            iconUrl: 'https://cdn.example.com/icon.png',
            customData: { plan: 'enterprise' },
          },
        },
      ],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.update('app-1', {
      corsOrigins: ['https://app.example.com'],
    })

    expect(db.updates[0]).toMatchObject({
      table: application,
      set: {
        metadata: {
          iconUrl: 'https://cdn.example.com/icon.png',
          corsOrigins: ['https://app.example.com'],
          customData: { plan: 'enterprise' },
        },
      },
    })

    await repository.update('app-1', {
      iconUrl: null,
      customData: {},
    })

    expect(db.updatesFor(application).at(-1)).toMatchObject({
      table: application,
      set: {
        metadata: {
          corsOrigins: ['https://app.example.com'],
          customData: {},
        },
      },
    })

    await repository.update('app-1', {
      iconUrl: null,
      corsOrigins: [],
      customData: {},
    })

    expect(db.updatesFor(application).at(-1)).toMatchObject({
      table: application,
      set: {
        metadata: {
          corsOrigins: [],
          customData: {},
        },
      },
    })
  })

  it('clears empty application metadata when the last metadata field is removed', async () => {
    const db = new FakeDb({
      application: [
        { id: 'app-1', oauthClientId: 'client-1', metadata: { iconUrl: 'https://cdn.example.com/icon.png' } },
      ],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.update('app-1', {
      iconUrl: null,
    })

    expect(db.updatesFor(application).at(-1)).toMatchObject({
      table: application,
      set: {
        metadata: null,
      },
    })
  })

  it('clears metadata when the last stored icon URL is removed', async () => {
    const db = new FakeDb({
      application: [
        {
          id: 'app-1',
          oauthClientId: 'client-1',
          metadata: {
            iconUrl: 'https://cdn.example.com/icon.png',
          },
        },
      ],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.update('app-1', { iconUrl: null })

    expect(db.updates[0]).toMatchObject({
      table: application,
      set: {
        metadata: null,
      },
    })
  })

  it('updates only provided application fields and skips missing applications', async () => {
    const db = new FakeDb({
      application: [{ id: 'app-1', oauthClientId: 'client-1' }],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.update('app-1', {
      slug: 'admin-console',
      description: 'Internal administration',
      firstParty: true,
      disabledReason: 'maintenance',
    })
    await createDrizzleApplicationRepository(new FakeDb() as unknown as Database).update('missing', {
      name: 'Missing',
    })

    expect(db.updates).toHaveLength(2)
    expect(db.updates[0]).toMatchObject({
      table: application,
      set: {
        slug: 'admin-console',
        description: 'Internal administration',
        firstParty: true,
        disabledReason: 'maintenance',
        updatedAt: expect.any(Date),
      },
    })
    expect(db.updates[1]).toMatchObject({
      table: oauthClient,
      set: {
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

  it('does not delete OAuth clients when the application is missing', async () => {
    const db = new FakeDb()
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await repository.delete('missing')

    expect(db.deletes).toEqual([])
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
})

function _applicationInput() {
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
    systemManaged: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://admin.example.com/callback'],
    postLogoutRedirectUris: [],
    corsOrigins: [],
    customData: {},
    allowedGrantTypes: ['authorization_code' as const],
    allowedScopes: ['openid' as const],
    requirePkce: false,
    tokenEndpointAuthMethod: 'client_secret_basic' as const,
    oidcClaims: {
      accessToken: {
        authorization: true,
        roles: true,
        permissions: true,
      },
      idToken: {},
      userInfo: {},
    },
  }
}

function date() {
  return new Date('2026-01-01T00:00:00.000Z')
}

function _applicationRow() {
  return {
    id: 'app-1',
    oauthClientId: 'client-1',
    slug: 'customer-portal',
    name: 'Customer Portal',
    description: null,
    homepageUrl: 'https://app.example.com',
    firstParty: true,
    trusted: true,
    disabled: false,
    disabledReason: null,
    metadata: {
      iconUrl: 'https://cdn.example.com/icon.png',
      corsOrigins: ['https://app.example.com'],
      customData: { plan: 'enterprise' },
      oidcClaims: {
        accessToken: { authorization: true, scopes: true, roles: true, permissions: true },
        idToken: { organizationId: true, organizationName: true },
        userInfo: { permissions: true },
      },
    },
    createdAt: date(),
    updatedAt: date(),
  }
}

function _oauthClientRow() {
  return {
    id: 'oauth-1',
    clientId: 'client-1',
    clientSecret: null,
    name: 'Customer Portal',
    icon: null,
    uri: 'https://app.example.com',
    redirectUris: '["https://app.example.com/callback"]',
    postLogoutRedirectUris: '["https://app.example.com/signed-out"]',
    grantTypes: '["authorization_code","refresh_token","invalid"]',
    responseTypes: '["code"]',
    scopes: '["openid","email","not-real"]',
    disabled: false,
    skipConsent: true,
    public: true,
    type: 'public_spa',
    requirePKCE: true,
    tokenEndpointAuthMethod: 'none',
    metadata: '{}',
    createdAt: date(),
    updatedAt: date(),
  }
}

class FakeDb {
  readonly inserts: Array<{
    table: unknown
    values: unknown
    conflict?: { type: 'update' | 'nothing'; config?: unknown }
  }> = []
  readonly updates: Array<{ table: unknown; set: unknown }> = []
  readonly deletes: Array<{ table: unknown }> = []

  constructor(
    private readonly rows: {
      application?: unknown[]
      applicationClientSecret?: unknown[]
      applicationConsent?: unknown[]
      aggregate?: unknown[]
    } = {},
  ) {}

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        const record: { table: unknown; values: unknown; conflict?: { type: 'update' | 'nothing'; config?: unknown } } =
          {
            table,
            values,
          }
        this.inserts.push(record)
        return {
          onConflictDoUpdate: (config: unknown) => {
            record.conflict = { type: 'update', config }
            return Promise.resolve(undefined)
          },
          onConflictDoNothing: (config?: unknown) => {
            record.conflict = { type: 'nothing', config }
            return Promise.resolve(undefined)
          },
        }
      },
    }
  }

  update(table: unknown) {
    return {
      set: (set: unknown) => ({
        where: async () => {
          this.updates.push({ table, set })
          if (table === application) {
            const applicationSet = set as Record<string, unknown>
            this.rows.application = this.rows.application?.map((row) =>
              typeof row === 'object' && row !== null ? { ...row, ...applicationSet } : row,
            )
          }
        },
      }),
    }
  }

  updatesFor(table: unknown) {
    return this.updates.filter((update) => update.table === table)
  }

  delete(table: unknown) {
    return {
      where: async () => {
        this.deletes.push({ table })
      },
    }
  }

  select(fields?: unknown) {
    return new FakeSelect(this.rows, fields)
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
  private joined = false
  private take: number | null = null

  constructor(
    private readonly rows: {
      application?: unknown[]
      applicationClientSecret?: unknown[]
      applicationConsent?: unknown[]
      aggregate?: unknown[]
    },
    private readonly fields?: unknown,
  ) {}

  from(table: unknown) {
    this.table = table
    return this
  }

  innerJoin() {
    this.joined = true
    return this
  }

  where() {
    return this
  }

  orderBy() {
    return this
  }

  limit(count: number) {
    this.take = count
    return this
  }

  offset() {
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable, and this fake mirrors that contract.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected)
  }

  private result() {
    if (this.fields && typeof this.fields === 'object' && 'total' in this.fields) {
      return [{ total: this.rowsForTable().length }]
    }
    const rows = this.rowsForTable()
    return this.take === null ? rows : rows.slice(0, this.take)
  }

  private rowsForTable() {
    if (this.joined) return this.rows.aggregate ?? []
    if (this.table === application) return this.rows.application ?? []
    if (this.table === applicationClientSecret) return this.rows.applicationClientSecret ?? []
    if (this.table === applicationConsent) return this.rows.applicationConsent ?? []
    return []
  }
}
