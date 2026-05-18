import { describe, expect, it } from 'vitest'
import { createConfigzService } from './context'
import { ConfigzService } from './service'

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
    expect((service as unknown as { options: unknown }).options).toEqual({
      issuer: 'https://auth.example.com',
      magicLinkEnabled: true,
      emailOtpEnabled: true,
      usernameEnabled: true,
      onboardingRepository,
      securityPolicy,
    })
  })
})
