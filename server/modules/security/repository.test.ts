import { describe, expect, it } from 'vitest'
import type { SecurityPolicy } from '../../../shared/api/security'
import type { Database } from '../../db/client'
import { signInExperience } from '../../db/schema'
import { createSecurityRepository } from './repository'

describe('createSecurityRepository', () => {
  it('reads managed security policy overrides from deployment settings metadata', async () => {
    const db = new FakeDb({
      settingsRows: [
        settingsRow({
          metadata: {
            securityPolicy: {
              mfa: { mode: 'required' },
              password: {
                minLength: 14,
                requiredCharacterTypes: 3,
                customWords: ['flareauth'],
                rejectUserInfo: true,
                rejectSequential: true,
                rejectCustomWords: true,
              },
              captcha: {
                enabled: true,
                provider: 'turnstile',
                siteKey: 'site-key-1',
                secretBinding: 'TURNSTILE_SECRET',
              },
              blocklist: {
                blockSubaddressing: true,
                entries: ['blocked@example.com', 'example.org'],
              },
            },
          },
        }),
      ],
    })

    const repository = createSecurityRepository(db as unknown as Database, defaultPolicy())

    await expect(repository.getPolicy()).resolves.toEqual({
      ...defaultPolicy(),
      mfa: { mode: 'required' },
      password: {
        minLength: 14,
        requiredCharacterTypes: 3,
        customWords: ['flareauth'],
        rejectUserInfo: true,
        rejectSequential: true,
        rejectCustomWords: true,
      },
      captcha: {
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-key-1',
        secretBinding: 'TURNSTILE_SECRET',
      },
      blocklist: {
        blockSubaddressing: true,
        entries: ['blocked@example.com', 'example.org'],
      },
    })
  })

  it('persists editable policy sections without overwriting deployment-owned passkeys or sessions', async () => {
    const db = new FakeDb({
      settingsRows: [
        settingsRow({
          metadata: {
            retained: 'metadata',
            securityPolicy: {
              mfa: { mode: 'optional' },
              password: defaultPolicy().password,
              captcha: defaultPolicy().captcha,
              blocklist: defaultPolicy().blocklist,
            },
          },
        }),
      ],
    })

    const repository = createSecurityRepository(
      db as unknown as Database,
      defaultPolicy({
        passkeys: {
          enabled: false,
          rpId: 'runtime.example.com',
          rpName: 'Runtime',
          origins: ['https://runtime.example.com'],
        },
        sessions: {
          expiresInSeconds: 7200,
          updateAgeSeconds: 600,
          freshAgeSeconds: 900,
          cookieCacheSeconds: 120,
        },
      }),
    )

    const policy = await repository.updatePolicy({
      policy: {
        mfa: { mode: 'required' },
        password: {
          minLength: 16,
          requiredCharacterTypes: 4,
          customWords: ['internal'],
          rejectUserInfo: true,
          rejectSequential: true,
          rejectCustomWords: true,
        },
        captcha: {
          enabled: true,
          provider: 'turnstile',
          siteKey: 'site-key-2',
          secretBinding: 'TURNSTILE_SECRET_2',
        },
        blocklist: {
          blockSubaddressing: true,
          entries: ['blocked@example.com'],
        },
      },
    })

    expect(policy).toEqual({
      mfa: { mode: 'required' },
      passkeys: {
        enabled: false,
        rpId: 'runtime.example.com',
        rpName: 'Runtime',
        origins: ['https://runtime.example.com'],
      },
      sessions: {
        expiresInSeconds: 7200,
        updateAgeSeconds: 600,
        freshAgeSeconds: 900,
        cookieCacheSeconds: 120,
      },
      password: {
        minLength: 16,
        requiredCharacterTypes: 4,
        customWords: ['internal'],
        rejectUserInfo: true,
        rejectSequential: true,
        rejectCustomWords: true,
      },
      captcha: {
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-key-2',
        secretBinding: 'TURNSTILE_SECRET_2',
      },
      blocklist: {
        blockSubaddressing: true,
        entries: ['blocked@example.com'],
      },
    })

    expect(db.writes).toEqual([
      {
        table: signInExperience,
        values: expect.objectContaining({
          id: 'default',
          metadata: {
            retained: 'metadata',
            securityPolicy: {
              mfa: { mode: 'required' },
              password: {
                minLength: 16,
                requiredCharacterTypes: 4,
                customWords: ['internal'],
                rejectUserInfo: true,
                rejectSequential: true,
                rejectCustomWords: true,
              },
              captcha: {
                enabled: true,
                provider: 'turnstile',
                siteKey: 'site-key-2',
                secretBinding: 'TURNSTILE_SECRET_2',
              },
              blocklist: {
                blockSubaddressing: true,
                entries: ['blocked@example.com'],
              },
            },
          },
          updatedAt: expect.any(Date),
        }),
        conflict: expect.objectContaining({
          target: signInExperience.id,
          set: expect.objectContaining({
            metadata: {
              retained: 'metadata',
              securityPolicy: {
                mfa: { mode: 'required' },
                password: {
                  minLength: 16,
                  requiredCharacterTypes: 4,
                  customWords: ['internal'],
                  rejectUserInfo: true,
                  rejectSequential: true,
                  rejectCustomWords: true,
                },
                captcha: {
                  enabled: true,
                  provider: 'turnstile',
                  siteKey: 'site-key-2',
                  secretBinding: 'TURNSTILE_SECRET_2',
                },
                blocklist: {
                  blockSubaddressing: true,
                  entries: ['blocked@example.com'],
                },
              },
            },
            updatedAt: expect.any(Date),
          }),
        }),
      },
    ])
  })

  it('falls back to legacy settings rows and ignores malformed managed metadata sections', async () => {
    const db = new FakeDb({
      settingsRows: [],
      legacySettingsRows: [
        settingsRow({
          id: 'legacy',
          metadata: {
            securityPolicy: {
              mfa: [],
              password: null,
              captcha: 'invalid',
              blocklist: ['invalid'],
            },
          },
        }),
      ],
    })

    const repository = createSecurityRepository(db as unknown as Database, defaultPolicy())

    await expect(repository.getPolicy()).resolves.toEqual(defaultPolicy())
    await repository.updatePolicy({ policy: { mfa: { mode: 'required' } } })
    expect(db.writes[0]?.values).toEqual(
      expect.objectContaining({
        defaultApplicationId: null,
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: true,
        identifierFirst: false,
        metadata: expect.objectContaining({
          securityPolicy: expect.objectContaining({ mfa: { mode: 'required' } }),
        }),
      }),
    )
  })

  it('reports missing users when reading security state', async () => {
    const repository = createSecurityRepository(new FakeDb() as unknown as Database, defaultPolicy())

    await expect(repository.getSecurityState('missing-user')).rejects.toThrow('User not found.')
  })
})

class FakeDb {
  readonly writes: Array<{ table: unknown; values: unknown; conflict: unknown }> = []

  constructor(
    private readonly rows: {
      settingsRows?: Array<Record<string, unknown>>
      legacySettingsRows?: Array<Record<string, unknown>>
    } = {},
  ) {}

  insert(table: unknown) {
    return {
      values: (values: unknown) => ({
        onConflictDoUpdate: async (conflict: unknown) => {
          this.writes.push({ table, values, conflict })
        },
      }),
    }
  }

  select() {
    return new FakeSelect(this.rows)
  }
}

class FakeSelect {
  private table: unknown

  constructor(
    private readonly rows: {
      settingsRows?: Array<Record<string, unknown>>
      legacySettingsRows?: Array<Record<string, unknown>>
    },
  ) {}

  from(table: unknown) {
    this.table = table
    return this
  }

  where() {
    const query = Promise.resolve(this.rowsForTable(true)) as Promise<Array<Record<string, unknown>>> & {
      limit: () => Promise<Array<Record<string, unknown>>>
    }
    query.limit = () => Promise.resolve(this.rowsForTable(true))
    return query
  }

  limit() {
    return Promise.resolve(this.rowsForTable())
  }

  private rowsForTable(filtered = false) {
    if (this.table === signInExperience) {
      return filtered ? (this.rows.settingsRows ?? []) : (this.rows.legacySettingsRows ?? this.rows.settingsRows ?? [])
    }
    return []
  }
}

function settingsRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'default',
    defaultApplicationId: null,
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    identifierFirst: false,
    defaultRedirectUri: null,
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
    metadata: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function defaultPolicy(overrides: Partial<SecurityPolicy> = {}): SecurityPolicy {
  return {
    mfa: {
      mode: 'optional',
      ...overrides.mfa,
    },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'FlareAuth',
      origins: ['https://auth.example.com'],
      ...overrides.passkeys,
    },
    sessions: {
      expiresInSeconds: 3600,
      updateAgeSeconds: 300,
      freshAgeSeconds: 600,
      cookieCacheSeconds: 60,
      ...overrides.sessions,
    },
    password: {
      minLength: 12,
      requiredCharacterTypes: 2,
      customWords: [],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: false,
      ...overrides.password,
    },
    captcha: {
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
      ...overrides.captcha,
    },
    blocklist: {
      blockSubaddressing: false,
      entries: [],
      ...overrides.blocklist,
    },
  }
}
