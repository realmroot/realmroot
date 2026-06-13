import { getConfig, getManagementSignInSettings } from '@server/usecases/configz'
import type { Deps } from '@server/usecases/deps'
import type { ConfigzRepository } from '@server/usecases/ports'
import { describe, expect, it } from 'vitest'

describe('configz fallback branches', () => {
  it('defaults email OTP availability and identifierFirst when options and settings omit them', async () => {
    const deps = createDeps(
      createRepository({
        settings: {
          passwordEnabled: true,
          signupEnabled: true,
          socialLoginEnabled: true,
          identifierFirst: false,
          termsUri: null,
          privacyUri: null,
          supportEmail: null,
          metadata: null,
        },
      }),
    )

    const config = await getConfig(deps, { issuer: 'https://auth.example.com' })

    expect(config.signIn).toMatchObject({
      emailOtpEnabled: true,
      usernameEnabled: true,
      identifierFirst: false,
    })
  })

  it('reads built-in provider overrides and copy from settings metadata', async () => {
    const deps = createDeps(
      createRepository({
        settings: {
          passwordEnabled: true,
          signupEnabled: true,
          socialLoginEnabled: true,
          identifierFirst: false,
          termsUri: null,
          privacyUri: null,
          supportEmail: null,
          metadata: {
            copy: {
              productName: '   ',
              headline: 'Welcome',
            },
            builtInProviders: {
              phone: { enabled: true },
              passkey: { allowSignUp: false },
              oneTap: { enabled: true, clientId: 'one-tap-client' },
            },
          },
        },
      }),
    )

    const config = await getConfig(deps, { issuer: 'https://auth.example.com' })

    expect(config.builtInProviders.phone.enabled).toBe(true)
    expect(config.builtInProviders.passkey.allowSignUp).toBe(false)
    expect(config.builtInProviders.oneTap).toMatchObject({ enabled: true, clientId: 'one-tap-client' })
    expect(config.copy).toMatchObject({
      productName: 'FlareAuth',
      headline: 'Welcome',
    })
  })

  it('defaults email OTP availability for management sign-in settings', async () => {
    const deps = createDeps(createRepository())

    const settings = await getManagementSignInSettings(deps, { issuer: 'https://auth.example.com' })

    expect(settings.builtInProviders.email.enabled).toBe(true)
  })
})

function createDeps(repository: ConfigzRepository): Deps {
  return {
    configz: repository,
    onboarding: { hasUsers: async () => true },
    connectors: { listEnabled: async () => [] },
  } as unknown as Deps
}

function createRepository(overrides: Partial<MockData> = {}): ConfigzRepository {
  return {
    getSettings: async () => overrides.settings ?? null,
    getBranding: async () => null,
    getAccountCenterSettings: async () => null,
    listEnabledIdentityProviders: async () => [],
    updateSettings: async () => undefined,
    updateBranding: async () => undefined,
    updateAccountCenterSettings: async () => undefined,
  }
}

type MockData = {
  settings: NonNullable<Awaited<ReturnType<ConfigzRepository['getSettings']>>>
}
