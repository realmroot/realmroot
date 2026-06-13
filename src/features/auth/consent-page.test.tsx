import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsentPage, signInWithReturnTo } from '@/features/auth/consent-page'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
  branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
  identityProviders: [],
  links: { termsUri: null, privacyUri: null, supportEmail: null },
  copy: { productName: 'Acme ID', headline: 'Sign in.', description: 'Hosted identity.' },
  auth: {},
  oidc: {},
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
    approveUrl: '/api/auth/oauth2/authorize?client_id=client-1',
    denyUrl: 'https://client.example.com/callback?error=access_denied&state=state-1',
  },
  requestedScopes: ['openid', 'profile'],
  existingConsent: null,
  state: 'state-1',
}

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.history.pushState(null, '', '/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com')
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState(null, '', '/')
})

describe('ConsentPage error and fallback paths', () => {
  it('shows a load error when the consent request cannot be fetched', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({ error: 'Consent expired.' }, 410))
    })

    render(<ConsentPage />)

    expect(await screen.findByText('Consent expired.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy()
  })

  it('warns when the consent request resolves empty', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse(null))
    })

    render(<ConsentPage />)

    expect(
      await screen.findByText('This consent request is no longer available. Start sign-in again from the application.'),
    ).toBeTruthy()
  })

  it('surfaces approval failures without redirecting', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/oauth/consent') && init?.method !== 'POST') {
        return Promise.resolve(jsonResponse(consentResponse))
      }
      return Promise.resolve(jsonResponse({ error: 'Approval rejected.' }, 400))
    })

    render(<ConsentPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Approve access' }))
    expect(await screen.findByText('Approval rejected.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Approve access' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces account switch failures without leaving the page', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.includes('/sign-out')) return Promise.resolve(jsonResponse({ error: 'Sign out failed.' }, 500))
      return Promise.resolve(jsonResponse(consentResponse))
    })

    render(<ConsentPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Switch account' }))
    expect(await screen.findByText('Sign out failed.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('falls back to the email and existing-consent details for accounts without a display name', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(
        jsonResponse({
          ...consentResponse,
          user: { email: 'jane@example.com', displayName: null, image: null },
          existingConsent: { id: 'consent-1', scopes: ['openid'], grantedAt: '2026-01-02T00:00:00.000Z' },
        }),
      )
    })

    render(<ConsentPage />)

    // displayName null -> email is the primary <strong> label, and the secondary
    // <small> email line also renders because it differs from the (null) name.
    await screen.findByText('Client App')
    const emails = screen.getAllByText('jane@example.com')
    expect(emails.some((el) => el.tagName === 'STRONG')).toBe(true)
    expect(emails.some((el) => el.tagName === 'SMALL')).toBe(true)
    expect(screen.getByText(/Previously approved on/)).toBeTruthy()
  })

  it('uses a generic message for non-Error load rejections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.reject('network down')
    })

    render(<ConsentPage />)

    expect(await screen.findByText('Unable to load consent request.')).toBeTruthy()
  })

  it('uses a generic message for non-Error approval rejections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/oauth/consent') && init?.method === 'POST') return Promise.reject('boom')
      return Promise.resolve(jsonResponse(consentResponse))
    })

    render(<ConsentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Approve access' }))
    expect(await screen.findByText('Unable to approve consent.')).toBeTruthy()
  })

  it('uses a generic message for non-Error sign-out rejections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.includes('/sign-out')) return Promise.reject('boom')
      return Promise.resolve(jsonResponse(consentResponse))
    })

    render(<ConsentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Switch account' }))
    expect(await screen.findByText('Unable to switch accounts.')).toBeTruthy()
  })

  it('labels an account with neither display name nor email as the current account', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(
        jsonResponse({
          ...consentResponse,
          user: { email: null, displayName: null, image: null },
        }),
      )
    })

    render(<ConsentPage />)
    expect(await screen.findByText('Current account')).toBeTruthy()
  })

  it('ignores consent resolution after the page unmounts', async () => {
    let resolveConsent: ((value: Response) => void) | undefined
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      return new Promise<Response>((resolve) => {
        resolveConsent = resolve
      })
    })

    const { unmount } = render(<ConsentPage />)
    unmount()
    resolveConsent?.(jsonResponse(consentResponse))
    await waitFor(() => expect(resolveConsent).toBeDefined())
    expect(screen.queryByText('Client App')).toBeNull()
  })

  it('builds a return-to sign-in link from the current location', () => {
    vi.unstubAllGlobals()
    window.history.pushState(null, '', '/oauth/consent?client_id=client-1&state=state-1')
    const expected = `/auth/sign-in?return_to=${encodeURIComponent('/oauth/consent?client_id=client-1&state=state-1')}`
    expect(signInWithReturnTo()).toBe(expected)
  })
})
