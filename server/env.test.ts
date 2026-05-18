import { describe, expect, it } from 'vitest'
import { type Env, validateEnv } from '../shared/env'

describe('validateEnv', () => {
  it('fails fast when required bindings or secrets are missing', () => {
    expect(() => validateEnv({} as Env, 'https://tenant.example.com/api/health')).toThrow(
      'DB binding is not configured for this deployment.',
    )
  })

  it('normalizes trusted origins and rejects non-origin entries', () => {
    expect(
      validateEnv(
        createEnv({ TRUSTED_ORIGINS: 'https://tenant.example.com/, https://tenant.example.com' }),
        'https://tenant.example.com/api/health',
      ).trustedOrigins,
    ).toEqual(['https://tenant.example.com'])

    expect(() =>
      validateEnv(createEnv({ TRUSTED_ORIGINS: 'https://tenant.example.com/path' }), 'https://tenant.example.com'),
    ).toThrow('TRUSTED_ORIGINS entry must be an origin: https://tenant.example.com/path')
  })

  it('normalizes base URL and rejects non-origin base URLs', () => {
    expect(
      validateEnv(createEnv({ BETTER_AUTH_URL: 'https://auth.example.com/' }), 'https://tenant.example.com').baseURL,
    ).toBe('https://auth.example.com')

    expect(() =>
      validateEnv(createEnv({ BETTER_AUTH_URL: 'https://auth.example.com/api/auth' }), 'https://tenant.example.com'),
    ).toThrow('BETTER_AUTH_URL must be an origin: https://auth.example.com/api/auth')
  })

  it('returns typed runtime config for a valid environment', () => {
    const env = createEnv({
      TRUSTED_ORIGINS: 'https://tenant.example.com, https://admin.example.com',
    })

    expect(validateEnv(env, 'https://tenant.example.com/api/health')).toEqual({
      authSecret: 'secret',
      baseURL: 'https://tenant.example.com',
      emailFrom: 'noreply@example.com',
      emailFromName: undefined,
      trustedOrigins: ['https://tenant.example.com', 'https://admin.example.com'],
    })
  })
})

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {},
    ASSETS: {},
    EMAIL: {
      send: async () => ({ messageId: 'email-1' }),
    },
    BETTER_AUTH_SECRET: 'secret',
    EMAIL_FROM: 'noreply@example.com',
    ...overrides,
  } as unknown as Env
}
