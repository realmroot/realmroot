import { captchaPolicySchema, updateSecurityPolicySchema } from '@shared/api/security'
import { describe, expect, it } from 'vitest'

describe('security policy API schemas', () => {
  it('validates enabled captcha provider credentials', () => {
    expect(
      captchaPolicySchema.parse({
        enabled: false,
        provider: 'turnstile',
        siteKey: '',
        secretKey: '',
        projectId: null,
      }),
    ).toMatchObject({ enabled: false })
    expect(
      captchaPolicySchema.safeParse({
        enabled: true,
        provider: 'turnstile',
        siteKey: '',
        secretKey: '',
        projectId: null,
      }).success,
    ).toBe(false)
    expect(
      captchaPolicySchema.parse({
        enabled: true,
        provider: 'turnstile',
        siteKey: 'site-key',
        secretKey: '',
        legacySecretBinding: 'TURNSTILE_SECRET_KEY',
        projectId: null,
      }),
    ).toMatchObject({ enabled: true })
    expect(
      captchaPolicySchema.safeParse({
        enabled: true,
        provider: 'recaptcha-enterprise',
        siteKey: 'site-key',
        secretKey: 'secret-key',
        projectId: null,
      }).success,
    ).toBe(false)
  })

  it('rejects session windows beyond the lifetime and validates managed captcha updates', () => {
    expect(
      updateSecurityPolicySchema.safeParse({
        policy: {
          sessions: {
            expiresInSeconds: 60,
            updateAgeSeconds: 61,
            freshAgeSeconds: 62,
            cookieCacheSeconds: 10,
          },
        },
      }).success,
    ).toBe(false)
    expect(
      updateSecurityPolicySchema.safeParse({
        policy: {
          captcha: {
            enabled: true,
            provider: 'recaptcha-enterprise',
            siteKey: '',
            projectId: null,
          },
        },
      }).success,
    ).toBe(false)
    expect(
      updateSecurityPolicySchema.parse({
        policy: {
          captcha: { enabled: false, provider: 'hcaptcha', siteKey: '', projectId: null },
        },
      }),
    ).toMatchObject({ policy: { captcha: { enabled: false } } })
  })
})
