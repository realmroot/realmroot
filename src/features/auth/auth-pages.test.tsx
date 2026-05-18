import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthCallbackPage,
  EmailVerificationPage,
  ForgotPasswordPage,
  resolveAuthRedirect,
  SignInPage,
  SignUpPage,
} from './auth-pages'
import { ConsentPage } from './consent-page'

const configz = {
  onboarding: { required: false, href: '/onboarding' },
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
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
  defaults: {
    applicationId: null,
    redirectUri: null,
  },
  auth: authPaths(),
  oidc: oidcMetadata(),
  security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
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
      userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/logout',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  requestedScopes: ['openid', 'profile'],
  existingConsent: null,
  state: 'state-1',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('hosted auth pages', () => {
  it('renders enabled sign-in methods and social connectors from configz', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Password' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Magic link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OTP' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy()
  })

  it('uses magic link when password auth is disabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          passwordEnabled: false,
          magicLinkEnabled: true,
          emailOtpEnabled: false,
        },
      }),
    )

    render(<SignInPage />)

    expect(await screen.findByRole('button', { name: 'Send magic link' })).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('submits password and OTP sign-in through native auth endpoints', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ url: '/account' }))
    })

    render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.click(screen.getByRole('button', { name: 'OTP' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    fireEvent.change(await screen.findByLabelText('One-time code'), { target: { value: '123456' } })
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

  it('submits magic link sign-in through the native auth endpoint', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Magic link' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))

    await waitFor(() => {
      expect(requests).toEqual([
        { url: '/api/auth/sign-in/magic-link', body: { email: 'jane@example.com', errorCallbackURL: '/sign-in' } },
      ])
    })
    expect(screen.getByText('Magic link sent. Check your email to continue.')).toBeTruthy()
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
    expect(resolveAuthRedirect({ url: '/auth/callback' }, '/account')).toBe('/auth/callback')
    expect(resolveAuthRedirect({ token: 'token-1' }, '/account')).toBe('/account')
    expect(resolveAuthRedirect({ token: 'token-1' }, undefined)).toBe('/account')
  })

  it('posts native Better Auth social sign-in and redirects to the provider authorization URL', async () => {
    window.history.pushState(
      null,
      '',
      '/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
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
          },
        },
      ])
    })
  })

  it('rejects external redirect targets from native auth responses and query params', () => {
    expect(resolveAuthRedirect({ url: 'https://evil.example.com/callback' }, '/account')).toBe('/account')
    expect(resolveAuthRedirect({ redirectTo: '//evil.example.com' }, '/account')).toBe('/account')
    expect(resolveAuthRedirect({}, 'https://evil.example.com/callback')).toBe('/account')
  })

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

  it('surfaces OAuth consent load and approval failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ error: { message: 'Consent request expired.' } }, 400))
    })

    render(<ConsentPage />)

    expect(await screen.findByText('Consent request expired.')).toBeTruthy()
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
            requestedScopes: ['email', 'offline_access', 'custom:scope'],
            existingConsent: { id: 'consent-1', scopes: ['email'], grantedAt: '2026-01-02T00:00:00.000Z' },
          }),
        )
      }
      return Promise.resolve(jsonResponse({ error: { message: 'Consent approval failed.' } }, 400))
    })
    vi.spyOn(window.history, 'back').mockImplementation(() => undefined)

    render(<ConsentPage />)

    expect(await screen.findByText('OAuth client application')).toBeTruthy()
    expect(screen.getByText('Share your email address and verification state.')).toBeTruthy()
    expect(screen.getByText('Allow refresh tokens for continued access.')).toBeTruthy()
    expect(screen.getByText('Allow this application to request this scope.')).toBeTruthy()
    expect(screen.getByText(/Previously approved on/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(window.history.back).toHaveBeenCalled()
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

    fireEvent.click(await screen.findByRole('button', { name: 'OTP code' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/request-password-reset',
        body: { email: 'jane@example.com' },
      })
    })

    fireEvent.change(await screen.findByLabelText('One-time code'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
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
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'jane' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
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

  it('requests and verifies email with OTP through native auth endpoints', async () => {
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
        url: '/api/auth/send-verification-email',
        body: { email: 'jane@example.com' },
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
    window.history.pushState(null, '', '/email-verification?token=token-1')
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

  it('renders callback errors, consent handoff, and safe account continuation', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    window.history.pushState(null, '', '/auth/callback?error=access_denied&error_description=Denied')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in could not continue.' })).toBeTruthy()
    expect(screen.getByText('Denied')).toBeTruthy()

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
    window.history.pushState(null, '', '/auth/callback?return_to=/admin/onboarding')
    render(<AuthCallbackPage />)
    expect(await screen.findByRole('heading', { name: 'Sign-in complete.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('/admin/onboarding')
  })

  it('accepts callbackURL fields from native auth responses', () => {
    expect(resolveAuthRedirect({ callbackURL: '/admin/onboarding' }, '/account')).toBe('/admin/onboarding')
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
    magicLinkPath: '/api/auth/sign-in/magic-link',
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
    userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  }
}
