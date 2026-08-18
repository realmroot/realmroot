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
    consentRequired: true,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://client.example.com/callback'],
    allowedGrantTypes: ['authorization_code'],
    oidcScopes: ['openid', 'profile', 'email'],
    resourceScopes: [],
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
  resourceServerId: null,
  requestedScopes: ['openid', 'profile'],
  requestedPermissions: [
    { value: 'openid', description: 'Confirm your identity with Realmroot.' },
    { value: 'profile', description: 'Share your name, profile image, and basic account details.' },
  ],
  addedScopes: ['openid', 'profile'],
  previouslyApprovedScopes: [],
  consentReason: 'initial',
  existingConsent: null,
  state: 'state-1',
}

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.history.pushState(null, '', '/auth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com')
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, assign })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.querySelector('link[rel="icon"]')?.remove()
  window.history.pushState(null, '', '/')
})

describe('ConsentPage error and fallback paths', () => {
  it('shows a recovery state for an incomplete consent URL [spec: hosted-auth/oauth-consent]', async () => {
    window.history.pushState(null, '', '/oauth/consent')
    vi.stubGlobal('location', { ...window.location, pathname: '/oauth/consent', search: '', assign })
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<ConsentPage />)

    expect(
      await screen.findByText('This consent request is incomplete. Start sign-in again from the application.'),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull()
    expect(screen.queryByText(/expected string|invalid_type/)).toBeNull()
  })

  it('completes the OAuth server consent handshake before redirecting [spec: hosted-auth/oauth-consent]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/account/application-authorization-request')) {
        return Promise.resolve(jsonResponse(consentResponse))
      }
      if (url.startsWith('/api/account/application-authorizations'))
        return Promise.resolve(jsonResponse({ consent: { id: 'consent-1' } }, 201))
      if (url.startsWith('/api/auth/oauth2/consent')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          accept: true,
          scope: 'openid profile',
          oauth_query: 'client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com',
        })
        return Promise.resolve(jsonResponse({ redirect: true, url: 'https://client.example.com/callback?code=code-1' }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<ConsentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://client.example.com/callback?code=code-1'))
    expect(requests).toEqual(
      expect.arrayContaining([
        '/api/account/application-authorization-request?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com',
        '/api/account/application-authorizations',
        '/api/auth/oauth2/consent',
      ]),
    )
  })

  it('approves two resource authorizations before one OAuth consent handshake [spec: hosted-auth/oauth-multi-resource-grant]', async () => {
    const approvalBodies: unknown[] = []
    const multiResourceConsent = {
      ...consentResponse,
      requestedScopes: ['openid', 'calendar:read', 'contacts:read'],
      resourceAuthorizations: [
        {
          resourceServerId: 'calendar-resource',
          resourceUrl: 'https://calendar.example.com/',
          resourceName: 'Calendar API',
          requestedScopes: ['openid', 'calendar:read'],
          requestedPermissions: [{ value: 'calendar:read', description: 'Read calendar entries.' }],
          addedScopes: ['openid', 'calendar:read'],
          previouslyApprovedScopes: [],
          consentReason: 'initial',
          existingConsent: null,
        },
        {
          resourceServerId: 'contacts-resource',
          resourceUrl: 'https://contacts.example.com/',
          resourceName: 'Contacts API',
          requestedScopes: ['openid', 'contacts:read'],
          requestedPermissions: [{ value: 'contacts:read', description: 'Read contacts.' }],
          addedScopes: ['openid', 'contacts:read'],
          previouslyApprovedScopes: [],
          consentReason: 'initial',
          existingConsent: null,
        },
      ],
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/account/application-authorization-request')) {
        return Promise.resolve(jsonResponse(multiResourceConsent))
      }
      if (url.startsWith('/api/account/application-authorizations')) {
        approvalBodies.push(JSON.parse(String(init?.body)))
        return Promise.resolve(jsonResponse({ consent: { id: `consent-${approvalBodies.length}` } }, 201))
      }
      if (url.startsWith('/api/auth/oauth2/consent')) {
        return Promise.resolve(jsonResponse({ redirect: true, url: 'https://client.example.com/callback?code=code-1' }))
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<ConsentPage />)

    expect(await screen.findByRole('heading', { name: 'Calendar API' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Contacts API' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Authorize' }))

    await waitFor(() => expect(assign).toHaveBeenCalled())
    expect(approvalBodies).toEqual([
      { clientId: 'client-1', resourceServerId: 'calendar-resource', scopes: ['openid', 'calendar:read'] },
      { clientId: 'client-1', resourceServerId: 'contacts-resource', scopes: ['openid', 'contacts:read'] },
    ])
  })

  it('completes denial through the OAuth server [spec: hosted-auth/oauth-consent-deny]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/account/application-authorization-request')) {
        return Promise.resolve(jsonResponse(consentResponse))
      }
      if (url.startsWith('/api/auth/oauth2/consent')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          accept: false,
          oauth_query: 'client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com',
        })
        return Promise.resolve(
          jsonResponse({ redirect: true, url: 'https://client.example.com/callback?error=access_denied' }),
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<ConsentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://client.example.com/callback?error=access_denied'))
  })

  it('surfaces a missing denial callback URL', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/account/application-authorization-request')) {
        return Promise.resolve(jsonResponse(consentResponse))
      }
      if (url.startsWith('/api/auth/oauth2/consent'))
        return Promise.resolve(jsonResponse({ redirect: false, url: null }))
      throw new Error(`Unexpected request: ${url}`)
    })

    render(<ConsentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText('The authorization server did not return a callback URL.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
  })

  it('renders application imagery, branded legal links, and permissions without descriptions', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            branding: { ...configz.branding, faviconUrl: 'https://realmroot.example/favicon.svg' },
            links: {
              ...configz.links,
              privacyUri: 'https://realmroot.example/privacy',
              termsUri: '/terms',
            },
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          ...consentResponse,
          application: {
            ...consentResponse.application,
            homepageUrl: null,
            iconUrl: 'https://client.example.com/icon.png',
          },
          user: {
            email: 'jane@example.com',
            displayName: 'jane@example.com',
            image: 'https://client.example.com/jane.png',
          },
          requestedScopes: ['custom:read'],
          requestedPermissions: [{ value: 'custom:read', description: null }],
          addedScopes: ['custom:read'],
        }),
      )
    })

    render(<ConsentPage />)

    expect(await screen.findByRole('heading', { name: 'Client App' })).toBeTruthy()
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href).toBe(
      'https://realmroot.example/favicon.svg',
    )
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('https://realmroot.example/privacy')
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/terms')
    expect(screen.getByText('custom:read')).toBeTruthy()
    expect(screen.queryByText('client.example.com')).toBeNull()
  })

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
    vi.spyOn(window, 'fetch').mockImplementation((input, _init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/account/application-authorization-request')) {
        return Promise.resolve(jsonResponse(consentResponse))
      }
      return Promise.resolve(jsonResponse({ error: 'Approval rejected.' }, 400))
    })

    render(<ConsentPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
    expect(await screen.findByText('Approval rejected.')).toBeTruthy()
    expect(assign).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Authorize' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('surfaces account switch failures without leaving the page', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.includes('/sign-out')) return Promise.resolve(jsonResponse({ error: 'Sign out failed.' }, 500))
      return Promise.resolve(jsonResponse(consentResponse))
    })

    render(<ConsentPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Change' }))
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
          addedScopes: [],
          previouslyApprovedScopes: ['openid', 'profile'],
          consentReason: 'reauthorization',
          existingConsent: { id: 'consent-1', scopes: ['openid'], grantedAt: '2026-01-02T00:00:00.000Z' },
        }),
      )
    })

    render(<ConsentPage />)

    await screen.findByRole('heading', { name: 'Client App' })
    const emails = screen.getAllByText('jane@example.com')
    expect(emails).toHaveLength(1)
    expect(emails[0]?.tagName).toBe('STRONG')
    expect(screen.getByText('Confirm existing access')).toBeTruthy()
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
    vi.spyOn(window, 'fetch').mockImplementation((input, _init) => {
      const url = String(input)
      if (url.startsWith('/api/configz')) return Promise.resolve(jsonResponse(configz))
      if (url.startsWith('/api/account/application-authorizations')) return Promise.reject('boom')
      return Promise.resolve(jsonResponse(consentResponse))
    })

    render(<ConsentPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }))
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
    window.history.pushState(null, '', '/auth/consent?client_id=client-1&state=state-1')
    const expected = `/auth/sign-in?return_to=${encodeURIComponent('/auth/consent?client_id=client-1&state=state-1')}`
    expect(signInWithReturnTo()).toBe(expected)
  })
})
