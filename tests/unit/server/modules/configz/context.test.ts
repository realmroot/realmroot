import { createConfigzService } from '@server/modules/configz/context'
import { ConfigzService } from '@server/usecases/configz'
import { describe, expect, it } from 'vitest'

describe('createConfigzService', () => {
  it('derives issuer and forwards runtime options into the configz service', () => {
    const onboardingRepository = { hasUsers: async () => true }
    const securityPolicy = {
      mfa: { mode: 'required' },
      passkeys: { enabled: true },
      sessions: { expiresInSeconds: 3600 },
    }

    const service = createConfigzService(
      {
        req: { url: 'https://auth.example.com/api/configz' },
        env: { DB: {} },
      } as never,
      {
        onboardingRepository: onboardingRepository as never,
        securityPolicy: securityPolicy as never,
      },
    )

    expect(service).toBeInstanceOf(ConfigzService)
    const options = (service as unknown as { options: Record<string, unknown> }).options
    expect(options).toMatchObject({
      issuer: 'https://auth.example.com',
      emailOtpEnabled: true,
      usernameEnabled: true,
      onboardingRepository,
      securityPolicy,
    })
    expect(options.availableIdentityProviderIds).toEqual(expect.any(Function))
  })
})
