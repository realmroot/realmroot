import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('hosted auth pages 2', () => {
  it('uses OTP when password auth is disabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          passwordEnabled: false,
          emailOtpEnabled: true,
        },
      }),
    )

    render(<SignInPage />)

    expect(await screen.findByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Create account' })).toBeNull()
  })

  it('starts with an identifier step when identifier-first sign-in is enabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          identifierFirst: true,
        },
      }),
    )

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Signing in as')).toBeTruthy()
    expect(screen.getByText('jane@example.com')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('keeps identifier-first identity when using an email code', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            signIn: {
              ...configz.signIn,
              identifierFirst: true,
            },
          }),
        )
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          { url: '/api/auth/email-otp/send-verification-otp', body: { email: 'jane@example.com', type: 'sign-in' } },
        ]),
      )
    })
  })

  it('uses a separate OTP email when identifier-first starts from a username', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            signIn: {
              ...configz.signIn,
              identifierFirst: true,
            },
          }),
        )
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/send-verification-otp',
        body: { email: 'jane@example.com', type: 'sign-in' },
      })
    })
  })

  it('shows user-facing OIDC destination context without raw client identifiers', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Continue to client.example.com.' })).toBeTruthy()
    expect(screen.getByText('Sign in with your hosted account to continue to client.example.com.')).toBeTruthy()
    expect(screen.queryByText(/client-1/)).toBeNull()
  })

  it('keeps app-specific hosted auth context across sign-up, recovery, and social sign-up', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/sign-up?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ url: 'https://github.com/login/oauth/authorize?state=social-state' }))
    })

    render(<SignUpPage />)

    expect(await screen.findByRole('heading', { name: 'Create an account for client.example.com.' })).toBeTruthy()
    expect(screen.getByText('Create a hosted account to continue to client.example.com.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Already have an account?' }).getAttribute('href')).toBe(
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/sign-in/social',
        body: {
          provider: 'github',
          callbackURL:
            '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
          errorCallbackURL: 'http://localhost:3000/auth/callback',
        },
      })
    })
  })

  it('does not render self-service registration when sign-up is disabled', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            signIn: { ...configz.signIn, signupEnabled: false },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignUpPage />)

    expect(await screen.findByRole('heading', { name: 'Password sign up is not available' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy()
  })

  it('does not render password registration when password auth is disabled', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            signIn: { ...configz.signIn, passwordEnabled: false, signupEnabled: true },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignUpPage />)

    expect(await screen.findByRole('heading', { name: 'Password sign up is not available' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeTruthy()
  })

  it('renders app-specific recovery context and preserves the hosted sign-in return path', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/forgot-password?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<ForgotPasswordPage />)

    expect(await screen.findByRole('heading', { name: 'Recover access for client.example.com.' })).toBeTruthy()
    expect(screen.getByText('Recover your hosted account before continuing to client.example.com.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
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
