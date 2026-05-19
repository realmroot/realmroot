import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './app'

vi.mock('@/lib/api', () => ({
  getPlatformStatus: vi.fn(),
  getConfigz: vi.fn(),
}))

import { getConfigz, getPlatformStatus } from '@/lib/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('shows first-run onboarding when configz requires it', async () => {
    vi.mocked(getPlatformStatus).mockResolvedValue({ ok: true, service: 'flareauth' })
    vi.mocked(getConfigz).mockResolvedValue({
      onboarding: { required: true, href: '/onboarding' },
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        socialLoginEnabled: false,
        magicLinkEnabled: false,
        emailOtpEnabled: false,
        usernameEnabled: false,
        identifierFirst: false,
      },
      branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
      identityProviders: [],
      links: { termsUri: null, privacyUri: null, supportEmail: null },
      copy: { productName: 'FlareAuth', headline: 'Sign in.', description: 'Hosted identity.' },
      defaults: { applicationId: null, redirectUri: null },
      auth: {
        basePath: '/api/auth',
        signInEmailPath: '/api/auth/sign-in/email',
        signInUsernamePath: '/api/auth/sign-in/username',
        signUpEmailPath: '/api/auth/sign-up/email',
        signOutPath: '/api/auth/sign-out',
        requestPasswordResetPath: '/api/auth/request-password-reset',
        resetPasswordPath: '/api/auth/reset-password',
        sendVerificationEmailPath: '/api/auth/send-verification-email',
        verifyEmailPath: '/api/auth/verify-email',
        magicLinkPath: '/api/auth/sign-in/magic-link',
        emailOtpPath: '/api/auth/email-otp/send-verification-otp',
        emailOtpSignInPath: '/api/auth/sign-in/email-otp',
        emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
        emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
        emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
      },
      oidc: {
        issuer: '/api/auth',
        discoveryUrl: '/api/auth/.well-known/openid-configuration',
        authorizationEndpoint: '/api/auth/oauth2/authorize',
        tokenEndpoint: '/api/auth/oauth2/token',
        jwksUri: '/api/auth/jwks',
        userInfoEndpoint: '/api/auth/oauth2/userinfo',
        endSessionEndpoint: '/api/auth/oauth2/logout',
      },
      security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: false },
    })

    render(<App />)

    expect(await screen.findByText('API status: online')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'First-run onboarding' }).getAttribute('href')).toBe('/onboarding')
  })

  it('surfaces unavailable platform status', async () => {
    vi.mocked(getPlatformStatus).mockRejectedValue(new Error('offline'))
    vi.mocked(getConfigz).mockResolvedValue({ onboarding: { required: false, href: '/onboarding' } } as never)

    render(<App />)

    expect(await screen.findByText('API status: unavailable')).toBeTruthy()
  })

  it('ignores async landing-page responses after unmount', async () => {
    const status = deferred<{ ok: true; service: string }>()
    const config = deferred<{ onboarding: { required: boolean; href: string } }>()
    vi.mocked(getPlatformStatus).mockReturnValue(status.promise)
    vi.mocked(getConfigz).mockReturnValue(config.promise as never)

    const view = render(<App />)
    view.unmount()

    await status.resolve({ ok: true, service: 'flareauth' })
    await config.resolve({ onboarding: { required: true, href: '/onboarding' } })

    expect(view.container.textContent).toBe('')
  })
})

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    async resolve(value: T) {
      resolvePromise(value)
      await promise
    },
  }
}
