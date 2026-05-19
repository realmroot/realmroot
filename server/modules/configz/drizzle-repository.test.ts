import { describe, expect, it } from 'vitest'
import type { Database } from '../../db/client'
import { brandingSetting, identityProviderConnector, signInExperience, uploadedAsset } from '../../db/schema'
import { createDrizzleConfigzRepository } from './drizzle-repository'

describe('createDrizzleConfigzRepository', () => {
  it('reads sign-in settings, branding, and enabled identity providers', async () => {
    const db = new FakeDb({
      settingsRows: [settingsRow()],
      brandingRows: [
        {
          branding: {
            applicationId: 'app-1',
            logoAssetId: 'asset-logo',
            faviconAssetId: 'asset-favicon',
            logoUrl: 'https://cdn.example.com/direct-logo.svg',
            faviconUrl: 'https://cdn.example.com/direct-favicon.ico',
            primaryColor: '#0f766e',
            backgroundColor: '#f8fafc',
            customCss: '--auth-panel-radius: 8px;',
          },
          logo: 'https://cdn.example.com/logo.svg',
        },
      ],
      faviconRows: [{ publicUrl: 'https://cdn.example.com/favicon.ico' }],
      identityProviderRows: [identityProviderRow()],
    })
    const repository = createDrizzleConfigzRepository(db as unknown as Database)

    await expect(repository.getSettings()).resolves.toEqual({
      defaultApplicationId: 'app-1',
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: true,
      identifierFirst: false,
      defaultRedirectUri: 'https://app.example.com/callback',
      termsUri: 'https://example.com/terms',
      privacyUri: 'https://example.com/privacy',
      supportEmail: 'support@example.com',
      metadata: { productCopy: 'Welcome' },
    })
    await expect(repository.getBranding('app-1')).resolves.toEqual({
      logoUrl: 'https://cdn.example.com/direct-logo.svg',
      logoAssetUrl: 'https://cdn.example.com/logo.svg',
      faviconUrl: 'https://cdn.example.com/direct-favicon.ico',
      faviconAssetUrl: 'https://cdn.example.com/favicon.ico',
      primaryColor: '#0f766e',
      backgroundColor: '#f8fafc',
      customCss: '--auth-panel-radius: 8px;',
    })
    await expect(repository.listEnabledIdentityProviders()).resolves.toEqual([
      { slug: 'google', providerType: 'social', providerId: 'google', displayName: 'Google', icon: 'google' },
    ])
  })

  it('returns null when deployment settings and branding rows are absent', async () => {
    const repository = createDrizzleConfigzRepository(new FakeDb() as unknown as Database)

    await expect(repository.getSettings()).resolves.toBeNull()
    await expect(repository.getBranding(null)).resolves.toBeNull()
  })

  it('does not use organization-scoped branding as deployment fallback', async () => {
    const repository = createDrizzleConfigzRepository(
      new FakeDb({
        brandingRows: [
          {
            branding: {
              applicationId: null,
              organizationId: 'org-1',
              logoAssetId: 'asset-org',
              faviconAssetId: null,
              logoUrl: null,
              faviconUrl: null,
              primaryColor: '#b91c1c',
              backgroundColor: '#fef2f2',
              customCss: null,
            },
            logo: 'https://cdn.example.com/org-logo.png',
          },
          {
            branding: {
              applicationId: null,
              organizationId: null,
              logoAssetId: 'asset-default',
              faviconAssetId: null,
              logoUrl: null,
              faviconUrl: null,
              primaryColor: '#111827',
              backgroundColor: '#ffffff',
              customCss: null,
            },
            logo: 'https://cdn.example.com/default-logo.png',
          },
        ],
      }) as unknown as Database,
    )

    await expect(repository.getBranding('missing-app')).resolves.toEqual({
      logoUrl: null,
      logoAssetUrl: 'https://cdn.example.com/default-logo.png',
      faviconUrl: null,
      faviconAssetUrl: null,
      primaryColor: '#111827',
      backgroundColor: '#ffffff',
      customCss: null,
    })
  })

  it('uses the generic OAuth icon for unknown enabled identity providers', async () => {
    const repository = createDrizzleConfigzRepository(
      new FakeDb({
        identityProviderRows: [
          {
            slug: 'custom',
            providerType: 'generic_oauth',
            providerId: 'custom-idp',
            displayName: 'Custom IdP',
          },
        ],
      }) as unknown as Database,
    )

    await expect(repository.listEnabledIdentityProviders()).resolves.toEqual([
      {
        slug: 'custom',
        providerType: 'generic_oauth',
        providerId: 'custom-idp',
        displayName: 'Custom IdP',
        icon: 'oauth',
      },
    ])
  })

  it('upserts singleton sign-in settings and preserves metadata copy', async () => {
    const db = new FakeDb({ settingsRows: [settingsRow()] })
    const repository = createDrizzleConfigzRepository(db as unknown as Database)

    await repository.updateSettings({
      passwordEnabled: false,
      supportEmail: 'help@example.com',
      copy: { productName: 'Acme ID' },
    })

    expect(db.writes).toEqual([
      {
        table: signInExperience,
        values: expect.objectContaining({
          id: 'default',
          passwordEnabled: false,
          signupEnabled: true,
          supportEmail: 'help@example.com',
          metadata: { productCopy: 'Welcome', copy: { productName: 'Acme ID' } },
        }),
        conflict: expect.objectContaining({
          target: signInExperience.id,
          set: expect.objectContaining({
            passwordEnabled: false,
            supportEmail: 'help@example.com',
            metadata: { productCopy: 'Welcome', copy: { productName: 'Acme ID' } },
          }),
        }),
      },
    ])
  })

  it('upserts global branding and copies through sign-in settings', async () => {
    const db = new FakeDb()
    const repository = createDrizzleConfigzRepository(db as unknown as Database)

    await repository.updateBranding({
      logoUrl: 'https://cdn.example.com/logo.svg',
      faviconUrl: null,
      primaryColor: '#2563eb',
      customCss: '--auth-panel-radius: 8px;',
      copy: { headline: 'Welcome' },
    })

    expect(db.writes).toEqual([
      expect.objectContaining({
        table: signInExperience,
        values: expect.objectContaining({
          id: 'default',
          metadata: { copy: { headline: 'Welcome' } },
        }),
      }),
      {
        table: brandingSetting,
        values: expect.objectContaining({
          id: 'branding_default',
          applicationId: null,
          organizationId: null,
          logoUrl: 'https://cdn.example.com/logo.svg',
          faviconUrl: null,
          primaryColor: '#2563eb',
          customCss: '--auth-panel-radius: 8px;',
        }),
        conflict: expect.objectContaining({
          target: brandingSetting.id,
          set: expect.objectContaining({
            applicationId: null,
            logoUrl: 'https://cdn.example.com/logo.svg',
            faviconUrl: null,
          }),
        }),
      },
    ])
  })
})

class FakeDb {
  readonly writes: Array<{ table: unknown; values: unknown; conflict: unknown }> = []

  constructor(
    private readonly rows: {
      settingsRows?: unknown[]
      brandingRows?: unknown[]
      faviconRows?: unknown[]
      identityProviderRows?: unknown[]
    } = {},
  ) {}

  select(fields?: unknown) {
    return new FakeSelect(this.rows, fields)
  }

  insert(table: unknown) {
    return new FakeInsert(this.writes, table)
  }
}

class FakeInsert {
  private input: unknown

  constructor(
    private readonly writes: Array<{ table: unknown; values: unknown; conflict: unknown }>,
    private readonly table: unknown,
  ) {}

  values(input: unknown) {
    this.input = input
    return this
  }

  onConflictDoUpdate(conflict: unknown) {
    this.writes.push({ table: this.table, values: this.input, conflict })
    return Promise.resolve()
  }
}

class FakeSelect {
  private table: unknown
  private joined = false

  constructor(
    private readonly rows: {
      settingsRows?: unknown[]
      brandingRows?: unknown[]
      faviconRows?: unknown[]
      identityProviderRows?: unknown[]
    },
    private readonly fields?: unknown,
  ) {}

  from(table: unknown) {
    this.table = table
    return this
  }

  leftJoin() {
    this.joined = true
    return this
  }

  where() {
    return this
  }

  limit() {
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
    if (this.table === signInExperience) return this.rows.settingsRows ?? []
    if (this.table === brandingSetting && this.joined) {
      const appRows = (this.rows.brandingRows ?? []).filter((row) => isApplicationBrandingRow(row))
      return appRows.length > 0 ? appRows : (this.rows.brandingRows ?? []).filter((row) => isDefaultBrandingRow(row))
    }
    if (this.table === uploadedAsset && this.fields && typeof this.fields === 'object' && 'publicUrl' in this.fields) {
      return this.rows.faviconRows ?? []
    }
    if (this.table === identityProviderConnector) return this.rows.identityProviderRows ?? []
    return []
  }
}

function isApplicationBrandingRow(row: unknown) {
  return (
    typeof row === 'object' &&
    row !== null &&
    'branding' in row &&
    typeof row.branding === 'object' &&
    row.branding !== null &&
    'applicationId' in row.branding &&
    row.branding.applicationId !== null
  )
}

function isDefaultBrandingRow(row: unknown) {
  return (
    typeof row === 'object' &&
    row !== null &&
    'branding' in row &&
    typeof row.branding === 'object' &&
    row.branding !== null &&
    'applicationId' in row.branding &&
    row.branding.applicationId === null &&
    'organizationId' in row.branding &&
    row.branding.organizationId === null
  )
}

function settingsRow() {
  return {
    defaultApplicationId: 'app-1',
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    identifierFirst: false,
    defaultRedirectUri: 'https://app.example.com/callback',
    termsUri: 'https://example.com/terms',
    privacyUri: 'https://example.com/privacy',
    supportEmail: 'support@example.com',
    metadata: { productCopy: 'Welcome' },
  }
}

function identityProviderRow() {
  return {
    slug: 'google',
    providerType: 'social',
    providerId: 'google',
    displayName: 'Google',
  }
}
