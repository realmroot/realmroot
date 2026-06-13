import { validateEmailPolicy, validatePasswordPolicy } from '@server/domain/security/policy'
import { captchaPolicySchema, type SecurityPolicy } from '@shared/api/security'
import { describe, expect, it } from 'vitest'

describe('security policy validation', () => {
  it('rejects passwords that match persisted policy constraints', () => {
    const policy: SecurityPolicy['password'] = {
      minLength: 12,
      requiredCharacterTypes: 3,
      customWords: ['tenant'],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: true,
    }

    expect(() => validatePasswordPolicy('Short1!', policy)).toThrow('Password must be at least 12 characters.')
    expect(() => validatePasswordPolicy('longbutplain', policy)).toThrow(
      'Password must include at least 3 character types.',
    )
    expect(() => validatePasswordPolicy('abcValidPass1!', policy)).toThrow(
      'Password cannot include sequential or repetitive characters.',
    )
    expect(() => validatePasswordPolicy('ValidJanePass1!', policy, { email: 'jane@example.com' })).toThrow(
      'Password cannot include account profile information.',
    )
    expect(() => validatePasswordPolicy('ValidTenantPass1!', policy)).toThrow('Password cannot include blocked words.')

    expect(() => validatePasswordPolicy('Valid-Password-42', policy)).not.toThrow()
  })

  it('rejects repetitive and descending sequential character runs', () => {
    const policy: SecurityPolicy['password'] = {
      minLength: 8,
      requiredCharacterTypes: 3,
      customWords: [],
      rejectUserInfo: false,
      rejectSequential: true,
      rejectCustomWords: false,
    }

    expect(() => validatePasswordPolicy('Vaaalid-Pass1!', policy)).toThrow(
      'Password cannot include sequential or repetitive characters.',
    )
    expect(() => validatePasswordPolicy('Validcba-Pass1!', policy)).toThrow(
      'Password cannot include sequential or repetitive characters.',
    )
  })

  it('rejects emails that match blocklist policy constraints', () => {
    const policy: SecurityPolicy['blocklist'] = {
      blockSubaddressing: true,
      entries: ['blocked@example.com', 'blocked.test'],
    }

    expect(() => validateEmailPolicy('invalid-email', policy)).toThrow('Email address is invalid.')
    expect(() => validateEmailPolicy('user+tag@example.com', policy)).toThrow('Email subaddressing is not allowed.')
    expect(() => validateEmailPolicy('blocked@example.com', policy)).toThrow('Email address is not allowed.')
    expect(() => validateEmailPolicy('user@blocked.test', policy)).toThrow('Email address is not allowed.')
    expect(() => validateEmailPolicy('allowed@example.com', policy)).not.toThrow()
  })

  it('requires Turnstile deployment bindings only when CAPTCHA is enabled', () => {
    expect(
      captchaPolicySchema.safeParse({
        enabled: false,
        provider: 'turnstile',
        siteKey: '',
        secretBinding: '',
      }).success,
    ).toBe(true)

    const result = captchaPolicySchema.safeParse({
      enabled: true,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['siteKey'], message: 'Site key is required.' }),
          expect.objectContaining({ path: ['secretBinding'], message: 'Secret binding is required.' }),
        ]),
      )
    }
  })
})
