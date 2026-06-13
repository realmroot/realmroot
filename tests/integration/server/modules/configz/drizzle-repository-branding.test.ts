import { createDrizzleConfigzRepository } from '@server/adapters/repos/configz'
import type { Database } from '@server/db/client'
import {
  accountCenterSetting,
  brandingSetting,
  identityProviderConnector,
  signInExperience,
  uploadedAsset,
} from '@server/db/schema'
import { describe, expect, it } from 'vitest'

describe('drizzle-repository.test 2', () => {
  it('uses default account center field permissions when metadata is incomplete or absent', async () => {
    const repository = createDrizzleConfigzRepository(
      new FakeDb({
        accountCenterRows: [
          {
            profileEditingEnabled: false,
            passwordChangeEnabled: true,
            connectedAccountsEnabled: false,
            sessionsViewEnabled: true,
            dangerZoneEnabled: false,
            metadata: {
              fieldPermissions: {
                displayNameEditable: 'not-boolean',
                usernameEditable: 'not-boolean',
                avatarEditable: 'not-boolean',
                emailChangeEnabled: 'not-boolean',
              },
            },
          },
        ],
      }) as unknown as Database,
    )

    await expect(repository.getAccountCenterSettings()).resolves.toMatchObject({
      profileEditingEnabled: false,
      displayNameEditable: true,
      usernameEditable: true,
      avatarEditable: true,
      emailChangeEnabled: true,
      passwordChangeEnabled: true,
      connectedAccountsEnabled: false,
      sessionsViewEnabled: true,
      dangerZoneEnabled: false,
    })
  })

  it('defaults account center field permissions when metadata is absent and preserves metadata on section-only updates', async () => {
    const db = new FakeDb({
      accountCenterRows: [
        {
          profileEditingEnabled: true,
          passwordChangeEnabled: true,
          connectedAccountsEnabled: true,
          sessionsViewEnabled: true,
          dangerZoneEnabled: false,
          metadata: null,
        },
      ],
    })
    const repository = createDrizzleConfigzRepository(db as unknown as Database)

    await expect(repository.getAccountCenterSettings()).resolves.toEqual({
      profileEditingEnabled: true,
      displayNameEditable: true,
      usernameEditable: true,
      avatarEditable: true,
      emailChangeEnabled: true,
      passwordChangeEnabled: true,
      connectedAccountsEnabled: true,
      sessionsViewEnabled: true,
      dangerZoneEnabled: false,
    })

    await repository.updateAccountCenterSettings({
      passwordChangeEnabled: false,
    })

    expect(db.writes).toEqual([
      expect.objectContaining({
        table: accountCenterSetting,
        conflict: expect.objectContaining({
          set: expect.not.objectContaining({
            metadata: expect.anything(),
          }),
        }),
      }),
    ])
  })

  it('upserts account center section settings from default settings when no row exists', async () => {
    const db = new FakeDb()
    const repository = createDrizzleConfigzRepository(db as unknown as Database)

    await expect(repository.getAccountCenterSettings()).resolves.toBeNull()
    await repository.updateAccountCenterSettings({
      sessionsViewEnabled: false,
    })

    expect(db.writes[0]).toMatchObject({
      table: accountCenterSetting,
      values: expect.objectContaining({
        sessionsViewEnabled: false,
        metadata: {
          fieldPermissions: {
            displayNameEditable: true,
            usernameEditable: true,
            avatarEditable: true,
            emailChangeEnabled: true,
          },
        },
      }),
      conflict: expect.objectContaining({
        target: accountCenterSetting.id,
        set: expect.objectContaining({
          sessionsViewEnabled: false,
        }),
      }),
    })
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
      accountCenterRows?: unknown[]
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
      accountCenterRows?: unknown[]
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
    if (this.table === accountCenterSetting) return this.rows.accountCenterRows ?? []
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

function _settingsRow() {
  return {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    identifierFirst: false,
    termsUri: 'https://example.com/terms',
    privacyUri: 'https://example.com/privacy',
    supportEmail: 'support@example.com',
    metadata: { productCopy: 'Welcome' },
  }
}

function _identityProviderRow() {
  return {
    slug: 'google',
    providerType: 'social',
    providerId: 'google',
    displayName: 'Google',
  }
}
