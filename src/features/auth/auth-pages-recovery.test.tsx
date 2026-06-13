import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailVerificationPage, ForgotPasswordPage } from '@/features/auth/pages/recovery'
import { SignInPage } from '@/features/auth/pages/sign-in'

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

describe('hosted auth pages 3', () => {
  it('preserves app-specific recovery context while requesting OTP password reset codes', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/forgot-password?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    expect(await screen.findByRole('heading', { name: 'Recover access for client.example.com.' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Email link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'OTP code' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/request-password-reset',
        body: { email: 'jane@example.com' },
      })
    })
  })

  it('drops reset tokens from preserved hosted auth continuation links', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/forgot-password?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1&token=reset-token',
    )
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<ForgotPasswordPage />)

    expect(await screen.findByRole('heading', { name: 'Recover access for client.example.com.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe(
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
  })

  it('renders app-specific email verification context', async () => {
    window.history.pushState(
      null,
      '',
      '/auth/email-verification?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<EmailVerificationPage />)

    expect(await screen.findByRole('heading', { name: 'Verify your email for client.example.com.' })).toBeTruthy()
    expect(screen.getByText('Confirm your email address before continuing to client.example.com.')).toBeTruthy()
  })

  it('uses generic OIDC context when redirect URI is invalid', async () => {
    window.history.pushState(null, '', '/auth/sign-in?client_id=client-1&redirect_uri=not-a-url')
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Continue to the requested application.' })).toBeTruthy()
    expect(screen.getByText('Sign in with your hosted account to continue.')).toBeTruthy()
    expect(screen.queryByText(/client-1/)).toBeNull()
  })

  it('submits password and OTP sign-in through native auth endpoints [spec: hosted-auth/email-otp-sign-in]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })

    render(<SignInPage />)

    const identifier = await screen.findByLabelText('Email or username')
    expect(identifier.getAttribute('autocomplete')).toBe('username')
    fireEvent.change(identifier, { target: { value: 'jane@example.com' } })
    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    fireEvent.change(password, { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          {
            url: '/api/auth/sign-in/email',
            body: { email: 'jane@example.com', password: 'password-1', rememberMe: true },
          },
          { url: '/api/auth/email-otp/send-verification-otp', body: { email: 'jane@example.com', type: 'sign-in' } },
          { url: '/api/auth/sign-in/email-otp', body: { email: 'jane@example.com', otp: '123456' } },
        ]),
      )
    })
  })

  it('submits phone sign-in through native auth endpoints when Phone is enabled [spec: connectors-and-methods/phone-sign-in]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz')
        return Promise.resolve(
          jsonResponse({
            ...configz,
            builtInProviders: { ...configz.builtInProviders, phone: { enabled: true } },
          }),
        )
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })

    render(<SignInPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Phone' }))
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: '+15555550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          { url: '/api/auth/phone-number/send-otp', body: { phoneNumber: '+15555550123' } },
          { url: '/api/auth/phone-number/verify', body: { phoneNumber: '+15555550123', code: '123456' } },
        ]),
      )
    })
  })

  it('surfaces wallet sign-in browser boundary errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            builtInProviders: {
              ...configz.builtInProviders,
              web3Wallet: { enabled: true, chains: [1], allowSignUp: true },
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Web3 wallet' }))
    expect(await screen.findByText('No wallet provider was found in this browser.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            builtInProviders: {
              ...configz.builtInProviders,
              web3Wallet: { enabled: true, chains: [1], allowSignUp: true },
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('0x2105')
        throw new Error(`Unsupported wallet method ${method}`)
      }),
    }
    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Web3 wallet' }))
    expect(await screen.findByText('This wallet network is not enabled. Switch to chain 1.')).toBeTruthy()
  })

  it('surfaces One Tap configuration errors before invoking Google Identity Services [spec: connectors-and-methods/onetap-flow]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            builtInProviders: {
              ...configz.builtInProviders,
              oneTap: { ...configz.builtInProviders.oneTap, enabled: true, clientId: '' },
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with OneTap' }))
    expect(await screen.findByText('Google One Tap Client ID is not configured.')).toBeTruthy()
  })

  it('toggles hosted password visibility controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)

    const password = (await screen.findByLabelText('Password')) as HTMLInputElement
    expect(password.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(password.type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(password.type).toBe('password')
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
