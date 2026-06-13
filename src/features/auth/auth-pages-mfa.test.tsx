import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAuthRedirect } from '@/features/auth/pages/controls'
import { ForgotPasswordPage } from '@/features/auth/pages/recovery'
import { SignInPage } from '@/features/auth/pages/sign-in'
import { SignUpPage } from '@/features/auth/pages/sign-up'

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

describe('hosted auth pages 4', () => {
  it('sets autocomplete attributes on hosted password forms', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)

    expect((await screen.findByLabelText('Email or username')).getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('current-password')

    cleanup()
    render(<SignUpPage />)

    expect((await screen.findByLabelText('Username')).getAttribute('autocomplete')).toBe('username')
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password')

    cleanup()
    window.history.pushState(null, '', '/auth/forgot-password')
    render(<ForgotPasswordPage />)

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    expect((await screen.findByLabelText('New password')).getAttribute('autocomplete')).toBe('new-password')
  })

  it('submits username sign-in when the identifier is not an email address', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ token: 'session-token' }))
    })

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/auth/sign-in/username',
          body: { username: 'jane', password: 'password-1', callbackURL: undefined, rememberMe: true },
        },
      ])
    })
  })

  it('requires TOTP verification before navigating after a two-factor password sign-in', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/auth/sign-in/username') {
        return Promise.resolve(jsonResponse({ twoFactorRedirect: true, twoFactorMethods: ['totp'] }))
      }
      return Promise.resolve(jsonResponse({ token: 'session-token' }))
    })

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter the current code from your authenticator app.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/two-factor/verify-totp',
        body: { code: '123456', trustDevice: true },
      })
    })
  })

  it('renders no method tabs or social buttons when all sign-in methods are disabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          passwordEnabled: false,
          emailOtpEnabled: false,
        },
        identityProviders: [],
      }),
    )

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull()
  })

  it('does not show an empty-method warning when only Phone sign-in is enabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          passwordEnabled: false,
          emailOtpEnabled: false,
          socialLoginEnabled: false,
        },
        builtInProviders: {
          ...configz.builtInProviders,
          phone: { enabled: true },
        },
        identityProviders: [],
      }),
    )

    render(<SignInPage />)

    expect(await screen.findByRole('button', { name: 'Continue with Phone' })).toBeTruthy()
    expect(screen.queryByText('No sign-in methods are enabled. Contact the workspace administrator.')).toBeNull()
  })

  it('surfaces native auth submission failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ error: { message: 'Invalid credentials.' } }, 401))
    })

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid credentials.')).toBeTruthy()
  })

  it('navigates after successful password sign-in', async () => {
    expect(resolveAuthRedirect({ url: '/auth/callback' }, '/profile')).toBe('/auth/callback')
    expect(resolveAuthRedirect({ token: 'token-1' }, '/profile')).toBe('/profile')
    expect(resolveAuthRedirect({ token: 'token-1' }, undefined)).toBe('/profile')
  })

  it('posts native Better Auth social sign-in and redirects to the provider authorization URL', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ url: 'https://github.com/login/oauth/authorize?state=social-state' }))
    })

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with GitHub' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/auth/sign-in/social',
          body: {
            provider: 'github',
            callbackURL:
              '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
            errorCallbackURL: 'http://localhost:3000/auth/callback',
          },
        },
      ])
    })
  })

  it('posts representative demo social sign-in with hosted callback context', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ url: 'https://example.com/oauth/authorize?state=demo-state' }))
    })

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Example SSO' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/auth/sign-in/social',
          body: {
            provider: 'demo-sso',
            callbackURL:
              '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
            errorCallbackURL: 'http://localhost:3000/auth/callback',
          },
        },
      ])
    })
  })

  it('keeps the page in place when social sign-in does not return a redirect URL', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with GitHub' }))

    await waitFor(() => expect(requests).toEqual([{ url: '/api/auth/sign-in/social', body: null }]))
  })

  it('rejects external redirect targets from native auth responses and query params', () => {
    expect(resolveAuthRedirect({ url: 'https://evil.example.com/callback' }, '/profile')).toBe('/profile')
    expect(resolveAuthRedirect({ redirectTo: '//evil.example.com' }, '/profile')).toBe('/profile')
    expect(resolveAuthRedirect({}, 'https://evil.example.com/callback')).toBe('/profile')
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
