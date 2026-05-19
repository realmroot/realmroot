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
            primaryColor: '#0f766e',
            backgroundColor: '#f8fafc',
            customCss: '.brand{}',
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
      logoUrl: 'https://cdn.example.com/logo.svg',
      faviconUrl: 'https://cdn.example.com/favicon.ico',
      primaryColor: '#0f766e',
      backgroundColor: '#f8fafc',
      customCss: '.brand{}',
    })
    await expect(repository.listEnabledIdentityProviders()).resolves.toEqual([
      { slug: 'google', providerType: 'social', providerId: 'google', displayName: 'Google' },
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
      logoUrl: 'https://cdn.example.com/default-logo.png',
      faviconUrl: null,
      primaryColor: '#111827',
      backgroundColor: '#ffffff',
      customCss: null,
    })
  })
})

class FakeDb {
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
