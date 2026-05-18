import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForgotPasswordPage, resolveAuthRedirect, SignInPage, socialAuthorizationUrl } from './auth-pages'
import { ConsentPage } from './consent-page'

const experienceConfig = {
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
      displayName: 'GitHub',
      authorizationUrl: '/api/auth/sign-in/social/github',
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
  it('renders enabled sign-in methods and social connectors from experience config', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(experienceConfig))

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Password' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Magic link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OTP' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue with GitHub' }).getAttribute('href')).toBe(
      '/api/auth/sign-in/social/github',
    )
  })

  it('uses magic link when password auth is disabled', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...experienceConfig,
        signIn: {
          ...experienceConfig.signIn,
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

  it('navigates after successful password sign-in', async () => {
    expect(resolveAuthRedirect({ url: '/auth/callback' }, '/account')).toBe('/auth/callback')
    expect(resolveAuthRedirect({ token: 'token-1' }, '/account')).toBe('/account')
    expect(resolveAuthRedirect({ token: 'token-1' }, undefined)).toBe('/account')
  })

  it('preserves OAuth authorize callback on social connector links', () => {
    window.history.pushState(
      null,
      '',
      '/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )

    expect(socialAuthorizationUrl('/api/auth/sign-in/social/github?prompt=select_account', callbackFromPage())).toBe(
      '/api/auth/sign-in/social/github?prompt=select_account&callbackURL=%2Fapi%2Fauth%2Foauth2%2Fauthorize%3Fclient_id%3Dclient-1%26redirect_uri%3Dhttps%253A%252F%252Fclient.example.com%252Fcallback%26state%3Dstate-1',
    )
    expect(
      socialAuthorizationUrl(
        'https://auth.example.com/api/auth/sign-in/social/github?prompt=select_account',
        callbackFromPage(),
      ),
    ).toBe(
      'https://auth.example.com/api/auth/sign-in/social/github?prompt=select_account&callbackURL=%2Fapi%2Fauth%2Foauth2%2Fauthorize%3Fclient_id%3Dclient-1%26redirect_uri%3Dhttps%253A%252F%252Fclient.example.com%252Fcallback%26state%3Dstate-1',
    )
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
      if (url.startsWith('/api/experience')) return Promise.resolve(jsonResponse(experienceConfig))
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

  it('requests an OTP password reset code before OTP reset completion', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/experience') return Promise.resolve(jsonResponse(experienceConfig))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'OTP code' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/experience/email-otp/password-reset-requests',
        body: { email: 'jane@example.com' },
      })
    })

    fireEvent.change(await screen.findByLabelText('One-time code'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/experience/email-otp/password-resets',
        body: { email: 'jane@example.com', otp: '123456', password: 'new-password' },
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

function callbackFromPage() {
  return `/api/auth/oauth2/authorize${window.location.search}`
}
