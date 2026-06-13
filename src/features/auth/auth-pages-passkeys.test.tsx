import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsentPage, signInWithReturnTo } from '@/features/auth/consent-page'
import { ForgotPasswordPage } from '@/features/auth/pages/recovery'
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

const consentResponse = {
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

describe('hosted auth pages 5', () => {
  it('posts OAuth consent approval and returns to the authorization endpoint', async () => {
    window.history.pushState(
      null,
      '',
      '/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/oauth/consent') && init?.method !== 'POST') {
        return Promise.resolve(jsonResponse(consentResponse))
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ consent: { id: 'consent-1', scopes: ['openid'], grantedAt: 'now' } }, 201))
    })

    render(<ConsentPage />)

    expect(await screen.findByRole('heading', { name: 'Client App' })).toBeTruthy()
    expect(screen.getByText('Signed in as')).toBeTruthy()
    expect(screen.getByText('Jane Stone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Switch account' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve access' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/oauth/consent',
          body: { clientId: 'client-1', scopes: ['openid', 'profile'] },
        },
      ])
    })
  })

  it('signs out from OAuth consent before switching accounts', async () => {
    window.history.pushState(
      null,
      '',
      '/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    expect(signInWithReturnTo()).toBe(
      '/auth/sign-in?return_to=%2Foauth%2Fconsent%3Fclient_id%3Dclient-1%26redirect_uri%3Dhttps%253A%252F%252Fclient.example.com%252Fcallback%26state%3Dstate-1',
    )

    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/oauth/consent')) return Promise.resolve(jsonResponse(consentResponse))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({}))
    })

    render(<ConsentPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Switch account' }))

    await waitFor(() => {
      expect(requests).toEqual([{ url: '/api/auth/sign-out', body: {} }])
    })
  })

  it('surfaces OAuth consent load and approval failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ error: { message: 'Consent request expired.' } }, 400))
    })

    render(<ConsentPage />)

    expect(await screen.findByText('Consent request expired.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/auth/sign-in')
    cleanup()
    vi.restoreAllMocks()
    window.history.pushState(null, '', '/oauth/consent?client_id=client-1&state=state-1')
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/oauth/consent') && init?.method !== 'POST') {
        return Promise.resolve(
          jsonResponse({
            ...consentResponse,
            application: {
              ...consentResponse.application,
              description: null,
              homepageUrl: null,
              iconUrl: 'https://client.example.com/icon.png',
            },
            user: {
              ...consentResponse.user,
              image: 'https://client.example.com/jane.png',
            },
            requestedScopes: ['email', 'offline_access', 'custom:scope'],
            existingConsent: { id: 'consent-1', scopes: ['email'], grantedAt: '2026-01-02T00:00:00.000Z' },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ error: { message: 'Consent approval failed.' } }, 400))
    })
    render(<ConsentPage />)

    expect(await screen.findByText('OAuth client application')).toBeTruthy()
    expect(document.querySelector('.applicationSummary img')?.getAttribute('width')).toBe('44')
    expect(document.querySelector('.applicationSummary img')?.getAttribute('height')).toBe('44')
    expect(document.querySelector('.consentAccount img')?.getAttribute('width')).toBe('40')
    expect(document.querySelector('.consentAccount img')?.getAttribute('height')).toBe('40')
    expect(screen.getByText('Share your email address and verification state.')).toBeTruthy()
    expect(screen.getByText('Allow refresh tokens for continued access.')).toBeTruthy()
    expect(screen.getByText('Allow this application to request this scope.')).toBeTruthy()
    expect(screen.getByText(/Previously approved on/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Deny' }).getAttribute('href')).toBe(
      'https://client.example.com/callback?error=access_denied&state=state-1',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve access' }))

    expect(await screen.findByText('Consent approval failed.')).toBeTruthy()
  })

  it('requests an OTP password reset code before OTP reset completion', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(screen.queryByText('Choose a recovery method')).toBeNull()
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
    expect((screen.getByRole('button', { name: /Resend code in \d+s/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(await screen.findByLabelText('One-time code'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
    expect(document.querySelector('input[autocomplete="username"]')).toHaveProperty('value', 'jane@example.com')
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/reset-password',
        body: { email: 'jane@example.com', otp: '123456', password: 'new-password' },
      })
    })
  })

  it('creates accounts through native sign-up and removes password fields after success', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ user: { id: 'user-1' } }))
    })

    render(<SignUpPage />)

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Jane Stone' } })
    const email = screen.getByLabelText('Email')
    expect(email.getAttribute('autocomplete')).toBe('email')
    fireEvent.change(email, { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jane' } })
    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('autocomplete')).toBe('new-password')
    fireEvent.change(password, { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/sign-up/email',
        body: {
          email: 'jane@example.com',
          name: 'Jane Stone',
          password: 'password-1',
          username: 'jane',
        },
      })
    })
    expect(await screen.findByText('Account created. Check your email if verification is required.')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('omits username from sign-up when username collection is disabled', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(jsonResponse({ ...configz, signIn: { ...configz.signIn, usernameEnabled: false } }))
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ user: { id: 'user-1' } }))
    })

    render(<SignUpPage />)

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Jane Stone' } })
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    expect(screen.queryByLabelText('Username')).toBeNull()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/sign-up/email',
        body: {
          email: 'jane@example.com',
          name: 'Jane Stone',
          password: 'password-1',
        },
      })
    })
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
