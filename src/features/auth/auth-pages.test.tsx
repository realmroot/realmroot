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
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('hosted auth pages', () => {
  it('renders enabled sign-in methods and social connectors from configz', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(screen.getByRole('main', { name: 'Hosted authentication' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(document.querySelector('.authPanel')).toBeTruthy()
    expect(document.querySelector('.authBrandPanel .brandMark')?.textContent).toBe('A')
    expect(document.querySelector('.segmented')?.children).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Password' }).className).toBe('active')
    expect(screen.getByRole('button', { name: 'Magic link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OTP' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toContain('uiButton-primary')
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with Example SSO' })).toBeTruthy()
    expect(screen.getByText('Powered by Acme ID')).toBeTruthy()
    expect(screen.queryByText('Authenticator verification')).toBeNull()
  })

  it('renders social connector icon variants from configz metadata', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        identityProviders: [
          { slug: 'github', providerType: 'social', providerId: 'github', displayName: 'GitHub', icon: 'github' },
          { slug: 'google', providerType: 'social', providerId: 'google', displayName: 'Google', icon: 'google' },
          {
            slug: 'microsoft',
            providerType: 'social',
            providerId: 'microsoft',
            displayName: 'Microsoft',
            icon: 'microsoft',
          },
          { slug: 'gitlab', providerType: 'social', providerId: 'gitlab', displayName: 'GitLab', icon: 'gitlab' },
          {
            slug: 'facebook',
            providerType: 'social',
            providerId: 'facebook',
            displayName: 'Facebook',
            icon: 'facebook',
          },
          { slug: 'apple', providerType: 'social', providerId: 'apple', displayName: 'Apple', icon: 'apple' },
          { slug: 'custom', providerType: 'social', providerId: 'custom', displayName: 'Custom', icon: 'oauth' },
        ],
      }),
    )

    render(<SignInPage />)

    for (const provider of ['GitHub', 'Google', 'Microsoft', 'GitLab', 'Facebook', 'Apple', 'Custom']) {
      expect(await screen.findByRole('button', { name: `Continue with ${provider}` })).toBeTruthy()
    }
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

  it('falls back to OTP when password and magic link auth are disabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          passwordEnabled: false,
          magicLinkEnabled: false,
          emailOtpEnabled: true,
        },
      }),
    )

    render(<SignInPage />)

    expect(await screen.findByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Magic link' })).toBeNull()
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

  it('keeps identifier-first identity across magic link and OTP methods', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Magic link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
    fireEvent.click(screen.getByRole('button', { name: 'OTP' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send code' }) as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          { url: '/api/auth/sign-in/magic-link', body: { email: 'jane@example.com', errorCallbackURL: '/sign-in' } },
          { url: '/api/auth/email-otp/send-verification-otp', body: { email: 'jane@example.com', type: 'sign-in' } },
        ]),
      )
    })
  })

  it('requires an email when identifier-first username switches to email-only methods', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Magic link' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/sign-in/magic-link',
        body: { email: 'jane@example.com', errorCallbackURL: '/sign-in' },
      })
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
    fireEvent.click(screen.getByRole('button', { name: 'OTP' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
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
      '/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Continue to client.example.com.' })).toBeTruthy()
    expect(screen.getByText('Sign in with your hosted account to continue to client.example.com.')).toBeTruthy()
    expect(screen.queryByText(/client-1/)).toBeNull()
  })

  it('uses generic OIDC context when redirect URI is invalid', async () => {
    window.history.pushState(null, '', '/sign-in?client_id=client-1&redirect_uri=not-a-url')
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Continue to the requested application.' })).toBeTruthy()
    expect(screen.getByText('Sign in with your hosted account to continue.')).toBeTruthy()
    expect(screen.queryByText(/client-1/)).toBeNull()
  })

  it('submits password and OTP sign-in through native auth endpoints', async () => {
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
    window.history.pushState(null, '', '/forgot-password?token=reset-token')
    render(<ForgotPasswordPage />)

    expect((await screen.findByLabelText('New password')).getAttribute('autocomplete')).toBe('new-password')

    cleanup()
    window.history.pushState(null, '', '/forgot-password')
    render(<ForgotPasswordPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'OTP code' }))
    expect(document.querySelector('.segmented')?.children).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
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

  it('renders no method tabs or social buttons when all sign-in methods are disabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        signIn: {
          ...configz.signIn,
          passwordEnabled: false,
          magicLinkEnabled: false,
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
    expect(resolveAuthRedirect({ url: '/auth/callback' }, '/profile')).toBe('/auth/callback')
    expect(resolveAuthRedirect({ token: 'token-1' }, '/profile')).toBe('/profile')
    expect(resolveAuthRedirect({ token: 'token-1' }, undefined)).toBe('/profile')
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

  it('posts representative demo social sign-in with hosted callback context', async () => {
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
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/sign-in')
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

  it('returns from OTP password reset to recovery method selection', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'OTP code' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    expect(await screen.findByLabelText('One-time code')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('One-time code'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change recovery method' }))

    expect(screen.queryByLabelText('One-time code')).toBeNull()
    expect(screen.queryByLabelText('New password')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send reset code' })).toBeTruthy()
  })

  it('requests password reset email links through native auth', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'OTP code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Email link' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/request-password-reset',
        body: { email: 'jane@example.com', redirectTo: 'http://localhost:3000/forgot-password' },
      })
    })
  })

  it('renders token password reset with a username field for password managers', async () => {
    window.history.pushState(null, '', '/forgot-password?token=token-1')
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    expect((await screen.findByLabelText('New password')).getAttribute('autocomplete')).toBe('new-password')
    expect(document.querySelector('input[autocomplete="username"]')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/reset-password',
        body: { token: 'token-1', newPassword: 'new-password' },
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
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('href')).toBe('/sign-in')

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
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  }
}
