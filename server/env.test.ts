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
      securityPolicy: {
        mfa: {
          mode: 'optional',
        },
        passkeys: {
          enabled: true,
          rpId: 'tenant.example.com',
          rpName: 'FlareAuth',
          origins: ['https://tenant.example.com', 'https://admin.example.com'],
        },
        sessions: {
          expiresInSeconds: 60 * 60 * 24 * 7,
          updateAgeSeconds: 60 * 60 * 24,
          freshAgeSeconds: 60 * 60 * 24,
          cookieCacheSeconds: 60 * 5,
        },
      },
    })
  })

  it('parses deployment security policy and explicit WebAuthn origins', () => {
    expect(
      validateEnv(
        createEnv({
          MFA_POLICY: 'required',
          PASSKEY_ENABLED: 'false',
          WEBAUTHN_RP_ID: 'auth.example.com',
          WEBAUTHN_RP_NAME: 'Example Auth',
          WEBAUTHN_ORIGINS: 'https://auth.example.com, https://preview.example.workers.dev',
          SESSION_DURATION_SECONDS: '3600',
          SESSION_UPDATE_AGE_SECONDS: '300',
          SESSION_FRESH_AGE_SECONDS: '600',
          SESSION_COOKIE_CACHE_SECONDS: '60',
        }),
        'https://tenant.example.com/api/health',
      ).securityPolicy,
    ).toEqual({
      mfa: {
        mode: 'required',
      },
      passkeys: {
        enabled: false,
        rpId: 'auth.example.com',
        rpName: 'Example Auth',
        origins: ['https://auth.example.com', 'https://preview.example.workers.dev'],
      },
      sessions: {
        expiresInSeconds: 3600,
        updateAgeSeconds: 300,
        freshAgeSeconds: 600,
        cookieCacheSeconds: 60,
      },
    })
  })

  it('fails fast for invalid security policy values', () => {
    expect(() => validateEnv(createEnv({ MFA_POLICY: 'sometimes' }), 'https://tenant.example.com')).toThrow(
      'MFA_POLICY must be one of: optional, required',
    )
    expect(() =>
      validateEnv(createEnv({ WEBAUTHN_RP_ID: 'https://auth.example.com' }), 'https://tenant.example.com'),
    ).toThrow('WEBAUTHN_RP_ID must be a domain name or localhost: https://auth.example.com')
    expect(() => validateEnv(createEnv({ SESSION_DURATION_SECONDS: '0' }), 'https://tenant.example.com')).toThrow(
      'SESSION_DURATION_SECONDS must be greater than 0',
    )
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
