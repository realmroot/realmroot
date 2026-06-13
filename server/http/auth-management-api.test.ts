import { createAuth } from '@server/auth'
import type {
  EmailOtpPluginOptions,
  OneTapPluginOptions,
  PhonePluginOptions,
  SiwePluginOptions,
} from '@server/auth-test-plugin-types'
import type { Database } from '@server/db/client'
import type { ManagementSignInSettingsResponse } from '@shared/api/management'
import { describe, expect, it, vi } from 'vitest'

describe('auth.test 4', () => {
  it('configures built-in email, phone, One Tap, and SIWE provider plugins', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ messages: [{ status: '0' }] }))
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy(),
      undefined,
      { builtInProviders: createBuiltInProviders() },
    )

    expect(findPlugin<EmailOtpPluginOptions>(auth, 'email-otp').options).toMatchObject({
      otpLength: 8,
      expiresIn: 900,
      changeEmail: {
        enabled: true,
        verifyCurrentEmail: false,
      },
    })
    expect(findPlugin<PhonePluginOptions>(auth, 'phone-number').options).toMatchObject({
      otpLength: 6,
      expiresIn: 300,
      requireVerification: true,
      signUpOnVerification: undefined,
    })
    expect(findPlugin<OneTapPluginOptions>(auth, 'one-tap').options).toMatchObject({
      clientId: 'google-client-id',
      disableSignup: false,
    })

    const siwe = findPlugin<SiwePluginOptions>(auth, 'siwe').options
    expect(siwe).toMatchObject({
      domain: 'wallet.example.com',
      emailDomainName: 'wallet.example.com',
      anonymous: true,
    })
    await expect(siwe.getNonce()).resolves.toMatch(/^[a-f0-9]{32}$/)

    const phone = findPlugin<PhonePluginOptions>(auth, 'phone-number').options
    await phone.sendOTP({ phoneNumber: '+15555550123', code: '123456' })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.twilio.com/2010-04-01/Accounts/twilio-sid/Messages.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: expect.stringContaining('Basic '),
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    )
  })

  it('sends phone OTPs through each configured SMS provider and fails invalid provider config', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ status: '0' }] }))

    const vonage = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        {
          builtInProviders: createBuiltInProviders({
            smsProvider: 'vonage',
            vonageApiKey: 'vonage-key',
            vonageApiSecret: 'vonage-secret',
            vonageFrom: 'FlareAuth',
          }),
        },
      ),
      'phone-number',
    ).options
    await vonage.sendPasswordResetOTP?.({ phoneNumber: '+15555550123', code: '123456' })
    expect(fetch).toHaveBeenCalledWith('https://rest.nexmo.com/sms/json', expect.objectContaining({ method: 'POST' }))

    const messageBird = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        {
          builtInProviders: createBuiltInProviders({
            smsProvider: 'messagebird',
            messageBirdAccessKey: 'messagebird-key',
            messageBirdOriginator: 'FlareAuth',
          }),
        },
      ),
      'phone-number',
    ).options
    await messageBird.sendOTP({ phoneNumber: '+15555550123', code: '123456' })
    expect(fetch).toHaveBeenCalledWith(
      'https://rest.messagebird.com/messages',
      expect.objectContaining({ method: 'POST' }),
    )

    const brokenTwilio = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        { builtInProviders: createBuiltInProviders({ twilioAuthToken: '' }) },
      ),
      'phone-number',
    ).options
    await expect(brokenTwilio.sendOTP({ phoneNumber: '+15555550123', code: '123456' })).rejects.toThrow(
      'Twilio SMS provider is not configured.',
    )

    const unsupported = findPlugin<PhonePluginOptions>(
      createAuth(
        {} as Database,
        '01234567890123456789012345678901',
        'https://auth.example.com',
        ['https://auth.example.com'],
        createEmailSenderMock(),
        createSecurityPolicy(),
        undefined,
        { builtInProviders: createBuiltInProviders({ smsProvider: 'unsupported' as 'twilio' }) },
      ),
      'phone-number',
    ).options
    await expect(unsupported.sendOTP({ phoneNumber: '+15555550123', code: '123456' })).rejects.toThrow(
      'Unsupported SMS provider: unsupported',
    )
  })

  it('disables direct passkey auth endpoints when passkeys are disabled by deployment policy', () => {
    const auth = createAuth(
      {} as Database,
      '01234567890123456789012345678901',
      'https://auth.example.com',
      ['https://auth.example.com'],
      createEmailSenderMock(),
      createSecurityPolicy({
        passkeys: {
          enabled: false,
          rpId: 'auth.example.com',
          rpName: 'FlareAuth',
          origins: ['https://auth.example.com'],
        },
      }),
    )

    expect(auth.options.disabledPaths).toEqual(
      expect.arrayContaining([
        '/passkey/generate-register-options',
        '/passkey/generate-authenticate-options',
        '/passkey/verify-registration',
        '/passkey/verify-authentication',
        '/passkey/list-user-passkeys',
        '/passkey/delete-passkey',
        '/passkey/update-passkey',
      ]),
    )
  })
})

function createEmailSenderMock() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: 'email-1' }),
  }
}

function createSecurityPolicy(overrides: Partial<SecurityPolicyInput> = {}) {
  return {
    mfa: {
      mode: 'optional',
      authenticatorAppEnabled: true,
      emailOtpEnabled: false,
      backupCodesEnabled: true,
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
      expiresInSeconds: 60 * 60 * 24 * 7,
      updateAgeSeconds: 60 * 60 * 24,
      freshAgeSeconds: 60 * 60 * 24,
      cookieCacheSeconds: 60 * 5,
      ...overrides.sessions,
    },
    password: {
      minLength: 8,
      requiredCharacterTypes: 1,
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
  } satisfies SecurityPolicyInput
}

function createBuiltInProviders(
  phoneOverrides: Partial<ManagementSignInSettingsResponse['builtInProviders']['phone']> = {},
): ManagementSignInSettingsResponse['builtInProviders'] {
  return {
    email: {
      enabled: true,
      otpLength: 8,
      expiresInSeconds: 900,
    },
    phone: {
      enabled: true,
      otpLength: 6,
      expiresInSeconds: 300,
      signUpOnVerification: false,
      requireVerification: true,
      smsProvider: 'twilio',
      twilioAccountSid: 'twilio-sid',
      twilioAuthToken: 'twilio-token',
      twilioFromNumber: '+15555550100',
      vonageApiKey: '',
      vonageApiSecret: '',
      vonageFrom: '',
      messageBirdAccessKey: '',
      messageBirdOriginator: '',
      ...phoneOverrides,
    },
    web3Wallet: {
      enabled: true,
      chains: [1],
      domain: 'wallet.example.com',
      emailDomainName: 'wallet.example.com',
      ensLookupEnabled: false,
      allowSignUp: true,
    },
    passkey: {
      allowSignUp: true,
    },
    oneTap: {
      enabled: true,
      clientId: 'google-client-id',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
      disableSignUp: false,
    },
  }
}

interface SecurityPolicyInput {
  mfa: {
    mode: 'optional' | 'required'
    authenticatorAppEnabled?: boolean
    emailOtpEnabled?: boolean
    backupCodesEnabled?: boolean
  }
  passkeys: {
    enabled: boolean
    rpId: string
    rpName: string
    origins: string[]
  }
  sessions: {
    expiresInSeconds: number
    updateAgeSeconds: number
    freshAgeSeconds: number
    cookieCacheSeconds: number
  }
  password: {
    minLength: number
    requiredCharacterTypes: number
    customWords: string[]
    rejectUserInfo: boolean
    rejectSequential: boolean
    rejectCustomWords: boolean
  }
  captcha: {
    enabled: boolean
    provider: 'turnstile'
    siteKey: string
    secretBinding: string
  }
  blocklist: {
    blockSubaddressing: boolean
    entries: string[]
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function findPlugin<TOptions extends object>(auth: ReturnType<typeof createAuth>, id: string) {
  const plugin = auth.options.plugins?.find((candidate) => candidate.id === id)

  if (!plugin) {
    throw new Error(`Plugin not found: ${id}`)
  }

  return plugin as unknown as { options: TOptions }
}
