import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAuthRedirect } from '@/features/auth/pages/controls'
import { AuthCallbackPage, EmailVerificationPage } from '@/features/auth/pages/recovery'

const configz = {
  onboarding: { required: false, href: '/onboarding' },
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
  },
  builtInProviders: {
    email: { enabled: true },
    phone: { enabled: false },
    web3Wallet: { enabled: false, chains: [1], allowSignUp: true },
    passkey: { allowSignUp: true },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
    },
  },
  branding: {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: '#b42318',
    backgroundColor: '#f7f3ee',
    customCss: null,
  },
  identityProviders: [
    {
      slug: 'github',
      providerType: 'social',
      providerId: 'github',
      displayName: 'GitHub',
      icon: 'github',
    },
    {
      slug: 'demo-sso',
      providerType: 'generic_oauth',
      providerId: 'demo-sso',
      displayName: 'Example SSO',
      icon: 'oauth',
    },
  ],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme ID',
    headline: 'Sign in to Acme.',
    description: 'Hosted identity for Acme apps.',
  },
  auth: authPaths(),
  oidc: oidcMetadata(),
  security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
  accountCenter: {
    profileEditingEnabled: true,
    displayNameEditable: true,
    usernameEditable: true,
    avatarEditable: true,
    emailChangeEnabled: true,
    passwordChangeEnabled: true,
    connectedAccountsEnabled: true,
    sessionsViewEnabled: true,
    dangerZoneEnabled: false,
  },
  captcha: { enabled: false, provider: 'turnstile', siteKey: '' },
}

const _consentResponse = {
  application: {
    id: 'app-1',
    slug: 'client',
    name: 'Client App',
    description: 'Reads profile data.',
    homepageUrl: 'https://client.example.com',
    iconUrl: null,
    clientId: 'client-1',
    clientType: 'public_spa',
    public: true,
    firstParty: false,
    trusted: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://client.example.com/callback'],
    allowedGrantTypes: ['authorization_code'],
    allowedScopes: ['openid', 'profile', 'email'],
    requirePkce: true,
    tokenEndpointAuthMethod: 'none',
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/logout',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  user: {
    email: 'jane@example.com',
    displayName: 'Jane Stone',
    image: null,
  },
  redirects: {
    approveUrl:
      '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    denyUrl: 'https://client.example.com/callback?error=access_denied&state=state-1',
  },
  requestedScopes: ['openid', 'profile'],
  existingConsent: null,
  state: 'state-1',
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.turnstile
  delete window.ethereum
  window.history.pushState(null, '', '/')
})

describe('hosted auth pages 6', () => {
  it('requests and verifies email with OTP through native auth endpoints [spec: hosted-auth/email-verification]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<EmailVerificationPage />)

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send verification' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/send-verification-otp',
        body: { email: 'jane@example.com', type: 'email-verification' },
      })
    })

    fireEvent.change(screen.getByLabelText('One-time code'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/verify-email',
        body: { email: 'jane@example.com', otp: '654321' },
      })
    })
  })

  it('verifies email token links through native auth', async () => {
    window.history.pushState(null, '', '/auth/email-verification?token=token-1')
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<EmailVerificationPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Verify email' }))

    await waitFor(() => {
      expect(window.fetch).toHaveBeenCalledWith('/api/auth/verify-email?token=token-1', {
        method: 'GET',
        headers: undefined,
        body: undefined,
      })
    })
  })

  it('renders callback errors, consent handoff, and safe account continuation [spec: hosted-auth/hosted-auth-error-flow]', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    window.history.pushState(null, '', '/auth/callback?error=access_denied&error_description=Denied')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in could not continue.' })).toBeTruthy()
    expect(screen.getByText('Denied')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/auth/sign-in')

    cleanup()
    window.history.pushState(null, '', '/auth/callback?error=email_not_found')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in could not continue.' })).toBeTruthy()
    expect(
      screen.getByText(
        'You do not have an account yet. This sign-in method did not provide account information. Sign in with another method first, then link this method to your account so you can use it next time.',
      ),
    ).toBeTruthy()

    cleanup()
    window.history.pushState(
      null,
      '',
      '/auth/callback?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Consent is required before redirecting.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(
      '/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )

    cleanup()
    window.history.pushState(null, '', '/auth/callback?return_to=/console/onboarding')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in complete.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/console/onboarding')
  })

  it('renders callback fallback error and account continuation defaults', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    window.history.pushState(null, '', '/auth/callback?error=access_denied')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in could not continue.' })).toBeTruthy()
    expect(screen.getByText('access_denied')).toBeTruthy()

    cleanup()
    window.history.pushState(null, '', '/auth/callback')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in complete.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/profile')
  })

  it('accepts callbackURL fields from native auth responses', () => {
    expect(resolveAuthRedirect({ callbackURL: '/console/onboarding' }, '/profile')).toBe('/console/onboarding')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authPaths() {
  return {
    basePath: '/api/auth',
    signInEmailPath: '/api/auth/sign-in/email',
    signInUsernamePath: '/api/auth/sign-in/username',
    signUpEmailPath: '/api/auth/sign-up/email',
    signOutPath: '/api/auth/sign-out',
    requestPasswordResetPath: '/api/auth/request-password-reset',
    resetPasswordPath: '/api/auth/reset-password',
    sendVerificationEmailPath: '/api/auth/send-verification-email',
    verifyEmailPath: '/api/auth/verify-email',
    emailOtpPath: '/api/auth/email-otp/send-verification-otp',
    emailOtpSignInPath: '/api/auth/sign-in/email-otp',
    emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
    emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
    emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
  }
}

function oidcMetadata() {
  return {
    issuer: 'https://auth.example.com/api/auth',
    discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
    authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
    tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
    jwksUri: 'https://auth.example.com/api/auth/jwks',
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  }
}
