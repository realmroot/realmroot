import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import { application, brandingSetting, oauthClient, organization, uploadedAsset, user } from '../../db/schema'
import { createDrizzleAssetRepository } from './drizzle-repository'

describe('createDrizzleAssetRepository', () => {
  it('creates and reads uploaded asset metadata', async () => {
    const db = new FakeDb()
    const repository = createDrizzleAssetRepository(db as unknown as Database)

    const asset = await repository.createAsset({
      id: 'asset-1',
      purpose: 'avatar',
      storageKey: 'avatar/aa/asset-1-avatar.png',
      publicUrl: 'https://auth.example.com/api/assets/asset-1',
      contentType: 'image/png',
      byteSize: 6,
      checksumSha256: 'checksum-1',
      createdByUserId: 'user-1',
    })

    expect(asset.createdAt).toEqual(expect.any(Date))
    expect(db.inserts).toEqual([
      {
        table: uploadedAsset,
        values: {
          id: 'asset-1',
          purpose: 'avatar',
          storageKey: 'avatar/aa/asset-1-avatar.png',
          publicUrl: 'https://auth.example.com/api/assets/asset-1',
          contentType: 'image/png',
          byteSize: 6,
          checksumSha256: 'checksum-1',
          createdByUserId: 'user-1',
          createdAt: expect.any(Date),
        },
      },
    ])

    await expect(
      createDrizzleAssetRepository(
        new FakeDb({
          uploadedAsset: [{ ...asset, publicUrl: null, checksumSha256: null }],
        }) as unknown as Database,
      ).findAsset('asset-1'),
    ).resolves.toMatchObject({
      id: 'asset-1',
      publicUrl: '/api/assets/asset-1',
      checksumSha256: '',
    })
  })

  it('updates user, application, organization, and branding asset references', async () => {
    const db = new FakeDb({
      user: [{ id: 'user-1' }],
      application: [{ id: 'app-1', oauthClientId: 'client-1', metadata: { color: 'red' } }],
      organization: [{ id: 'org-1' }],
      brandingSetting: [{ id: 'branding-1', applicationId: null, organizationId: null }],
    })
    const repository = createDrizzleAssetRepository(db as unknown as Database)

    await repository.updateUserAvatar('user-1', 'asset-1', 'https://auth.example.com/api/assets/asset-1')
    await repository.updateApplicationLogo('app-1', 'asset-2', 'https://auth.example.com/api/assets/asset-2')
    await repository.updateOrganizationLogo('org-1', 'asset-3', 'https://auth.example.com/api/assets/asset-3')
    await repository.updateBrandingAsset('logo', 'asset-4')
    await repository.updateBrandingAsset('favicon', 'asset-5')

    expect(db.updates).toEqual([
      {
        table: user,
        set: {
          avatarAssetId: 'asset-1',
          image: 'https://auth.example.com/api/assets/asset-1',
          updatedAt: expect.any(Date),
        },
      },
      {
        table: application,
        set: {
          logoAssetId: 'asset-2',
          metadata: { color: 'red', iconUrl: 'https://auth.example.com/api/assets/asset-2' },
          updatedAt: expect.any(Date),
        },
      },
      {
        table: oauthClient,
        set: { icon: 'https://auth.example.com/api/assets/asset-2', updatedAt: expect.any(Date) },
      },
      {
        table: organization,
        set: {
          logoAssetId: 'asset-3',
          logo: 'https://auth.example.com/api/assets/asset-3',
          updatedAt: expect.any(Date),
        },
      },
      { table: brandingSetting, set: { logoAssetId: 'asset-4', updatedAt: expect.any(Date) } },
      { table: brandingSetting, set: { faviconAssetId: 'asset-5', updatedAt: expect.any(Date) } },
    ])
  })

  it('inserts default branding and surfaces missing target rows', async () => {
    const repository = createDrizzleAssetRepository(new FakeDb() as unknown as Database)

    await expect(repository.updateUserAvatar('missing', 'asset-1', '/api/assets/asset-1')).rejects.toMatchObject({
      status: 404,
    })
    await expect(repository.updateApplicationLogo('missing', 'asset-1', '/api/assets/asset-1')).rejects.toMatchObject({
      status: 404,
    })
    await expect(repository.updateOrganizationLogo('missing', 'asset-1', '/api/assets/asset-1')).rejects.toMatchObject({
      status: 404,
    })

    const db = new FakeDb()
    await createDrizzleAssetRepository(db as unknown as Database).updateBrandingAsset('logo', 'asset-1')
    expect(db.inserts).toEqual([
      {
        table: brandingSetting,
        values: { id: 'branding_default', logoAssetId: 'asset-1', updatedAt: expect.any(Date) },
      },
    ])
  })

  it('does not overwrite organization-scoped branding when updating deployment branding', async () => {
    const db = new FakeDb({
      brandingSetting: [
        { id: 'branding-org', applicationId: null, organizationId: 'org-1' },
        { id: 'branding-default', applicationId: null, organizationId: null },
      ],
    })

    await createDrizzleAssetRepository(db as unknown as Database).updateBrandingAsset('logo', 'asset-1')

    expect(db.updates).toEqual([
      { table: brandingSetting, set: { logoAssetId: 'asset-1', updatedAt: expect.any(Date) } },
    ])
    expect(db.updateWheres).toHaveLength(1)
  })
})

class FakeDb {
  readonly inserts: Array<{ table: unknown; values: unknown }> = []
  readonly updates: Array<{ table: unknown; set: unknown }> = []
  readonly updateWheres: unknown[] = []

  constructor(
    private readonly rows: {
      application?: unknown[]
      brandingSetting?: unknown[]
      organization?: unknown[]
      uploadedAsset?: unknown[]
      user?: unknown[]
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
        where: (where?: unknown) => ({
          returning: async () => {
            this.updates.push({ table, set })
            this.updateWheres.push(where)
            return this.rowsForTable(table)
          },
          // biome-ignore lint/suspicious/noThenProperty: Drizzle update builders are awaitable, and this fake mirrors that contract.
          then: <TResult1 = unknown[], TResult2 = never>(
            onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) => {
            this.updates.push({ table, set })
            this.updateWheres.push(where)
            return Promise.resolve(this.rowsForTable(table)).then(onfulfilled, onrejected)
          },
        }),
      }),
    }
  }

  select() {
    return new FakeSelect(this.rows)
  }

  async batch(statements: unknown[]) {
    return Promise.all(statements)
  }

  private rowsForTable(table: unknown) {
    if (table === application) return this.rows.application ?? []
    if (table === brandingSetting) return this.rows.brandingSetting ?? []
    if (table === organization) return this.rows.organization ?? []
    if (table === user) return this.rows.user ?? []
    return []
  }
}

class FakeSelect {
  private table: unknown
  private take: number | null = null

  constructor(
    private readonly rows: {
      application?: unknown[]
      brandingSetting?: unknown[]
      uploadedAsset?: unknown[]
    },
  ) {}

  from(table: unknown) {
    this.table = table
    return this
  }

  where() {
    return this
  }

  limit(count: number) {
    this.take = count
    return this
  }

  // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable, and this fake mirrors that contract.
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    const rows = this.rowsForTable()
    return Promise.resolve(this.take === null ? rows : rows.slice(0, this.take)).then(onfulfilled, onrejected)
  }

  private rowsForTable() {
    if (this.table === application) return this.rows.application ?? []
    if (this.table === brandingSetting) {
      return (this.rows.brandingSetting ?? []).filter(
        (row) =>
          typeof row === 'object' &&
          row !== null &&
          'applicationId' in row &&
          'organizationId' in row &&
          row.applicationId === null &&
          row.organizationId === null,
      )
    }
    if (this.table === uploadedAsset) return this.rows.uploadedAsset ?? []
    return []
  }
}
