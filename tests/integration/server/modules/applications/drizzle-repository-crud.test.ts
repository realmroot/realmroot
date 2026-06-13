import { createDrizzleApplicationRepository } from '@server/adapters/repos/applications'
import type { Database } from '@server/db/client'
import { application, applicationClientSecret, applicationConsent } from '@server/db/schema'
import { describe, expect, it } from 'vitest'

describe('drizzle-repository.test 1', () => {
  it('lists, finds, and maps application aggregates from OAuth client rows', async () => {
    const db = new FakeDb({
      application: [applicationRow()],
      aggregate: [{ application: applicationRow(), oauthClient: oauthClientRow() }],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await expect(repository.list({ limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          id: 'app-1',
          clientId: 'client-1',
          iconUrl: 'https://cdn.example.com/icon.png',
          corsOrigins: ['https://app.example.com'],
          customData: { plan: 'enterprise' },
          oidcClaims: {
            accessToken: { authorization: true, scopes: true, roles: true, permissions: true },
            idToken: { organizationId: true, organizationName: true },
            userInfo: { permissions: true },
          },
          clientType: 'public_spa',
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
          allowedScopes: ['openid', 'email'],
          tokenEndpointAuthMethod: 'none',
        },
      ],
      pagination: { limit: 10, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })
    await expect(repository.findById('app-1')).resolves.toMatchObject({ id: 'app-1' })
    await expect(repository.findByClientId('client-1')).resolves.toMatchObject({ clientId: 'client-1' })
    await expect(
      createDrizzleApplicationRepository(new FakeDb() as unknown as Database).findById('missing'),
    ).resolves.toBeNull()
  })

  it('maps OAuth client row variants for public native and confidential clients', async () => {
    const metadataIconApp = {
      ...applicationRow(),
      id: 'app-2',
      metadata: {
        iconUrl: 'https://cdn.example.com/metadata-icon.png',
        corsOrigins: ['https://metadata.example.com'],
        customData: { plan: 'growth' },
        systemManaged: true,
      },
    }
    const invalidMetadataApp = {
      ...applicationRow(),
      id: 'app-3',
      metadata: { iconUrl: 42, corsOrigins: 'not-array', customData: [], oidcClaims: { accessToken: [] } },
      disabled: true,
    }
    const db = new FakeDb({
      application: [metadataIconApp, invalidMetadataApp, applicationRow()],
      aggregate: [
        {
          application: metadataIconApp,
          oauthClient: {
            ...oauthClientRow(),
            clientId: 'client-2',
            icon: null,
            public: null,
            type: 'public_native',
            requirePKCE: null,
            tokenEndpointAuthMethod: 'client_secret_post',
            redirectUris: null,
            grantTypes: null,
            scopes: '"not-array"',
          },
        },
        {
          application: invalidMetadataApp,
          oauthClient: {
            ...oauthClientRow(),
            clientId: 'client-3',
            icon: null,
            disabled: true,
            type: 'not-real',
            tokenEndpointAuthMethod: 'not-real',
            redirectUris: '["com.example.app:/callback",42]',
            grantTypes: '["client_credentials"]',
            scopes: '["offline_access"]',
          },
        },
        {
          application: applicationRow(),
          oauthClient: {
            ...oauthClientRow(),
            clientId: 'client-4',
            type: 'confidential_web',
            tokenEndpointAuthMethod: 'client_secret_basic',
          },
        },
      ],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await expect(repository.list({ limit: 2, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          clientId: 'client-2',
          iconUrl: 'https://cdn.example.com/metadata-icon.png',
          clientType: 'public_native',
          public: false,
          redirectUris: [],
          corsOrigins: ['https://metadata.example.com'],
          customData: { plan: 'growth' },
          systemManaged: true,
          allowedGrantTypes: [],
          allowedScopes: [],
          requirePkce: false,
          tokenEndpointAuthMethod: 'client_secret_post',
        },
        {
          clientId: 'client-3',
          iconUrl: null,
          corsOrigins: [],
          customData: {},
          clientType: 'confidential_web',
          disabled: true,
          redirectUris: ['com.example.app:/callback'],
          allowedGrantTypes: ['client_credentials'],
          allowedScopes: ['offline_access'],
          tokenEndpointAuthMethod: 'client_secret_basic',
        },
      ],
      pagination: { hasMore: true, nextOffset: 2, total: 3 },
    })
  })

  it('maps non-object application metadata to empty application metadata fields', async () => {
    const db = new FakeDb({
      aggregate: [
        {
          application: {
            ...applicationRow(),
            metadata: 'not-object',
          },
          oauthClient: oauthClientRow(),
        },
      ],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await expect(repository.list({ limit: 1, offset: 0 })).resolves.toMatchObject({
      items: [
        {
          iconUrl: null,
          corsOrigins: [],
          customData: {},
        },
      ],
    })
  })

  it('lists client secrets and reads active consent records', async () => {
    const db = new FakeDb({
      applicationClientSecret: [
        {
          id: 'secret-1',
          applicationId: 'app-1',
          version: 1,
          secretHash: 'hash',
          secretPrefix: 'fas_secret_',
          status: 'active',
          createdByUserId: 'admin-1',
          materializedToOauthClientAt: date(),
          createdAt: date(),
          expiresAt: null,
          revokedAt: null,
        },
      ],
      applicationConsent: [
        {
          id: 'consent-1',
          applicationId: 'app-1',
          userId: 'user-1',
          scopes: ['openid', 'email', 'unknown'],
          permissions: ['contacts.read'],
          grantedAt: date(),
          revokedAt: null,
        },
      ],
    })
    const repository = createDrizzleApplicationRepository(db as unknown as Database)

    await expect(repository.listSecrets('app-1', { limit: 10, offset: 0 })).resolves.toMatchObject({
      items: [{ id: 'secret-1', version: 1 }],
      pagination: { total: 1 },
    })
    await expect(repository.findConsent('app-1', 'user-1')).resolves.toEqual({
      id: 'consent-1',
      scopes: ['openid', 'email'],
      grantedAt: date(),
    })
    await expect(
      createDrizzleApplicationRepository(new FakeDb() as unknown as Database).findConsent('app-1', 'user-1'),
    ).resolves.toBeNull()
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

function applicationRow() {
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

function oauthClientRow() {
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
