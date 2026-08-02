import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailPage } from '@/features/console/extracted/applications/application-detail'
import { ApplicationsPage } from '@/features/console/extracted/applications/applications-list'
import { queryClient } from '@/router'
import { application, consoleSharedFetch, jsonResponse, pagination, renderWithQuery } from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('admin console applications-detail-a', () => {
  it('renders the unified application inventory with compact client metadata', async () => {
    const thirdPartyApplication = {
      ...application,
      id: 'app-2',
      clientId: 'partner-client',
      firstParty: false,
      name: 'Partner app',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application, thirdPartyApplication], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    expect(screen.getByText('Partner app')).toBeTruthy()
    expect(screen.getByText('partner-client')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Audience' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'My apps' })).toBeNull()
    expect(screen.queryByLabelText('Upload logo for Customer portal')).toBeNull()
  })

  it('shows and revokes real application authorizations [spec: admin-console/admin-application-detail]', async () => {
    let active = true
    let revocations = 0
    const authorization = {
      id: 'authorization-1',
      applicationId: 'app-1',
      user: { id: 'user-1', displayName: 'Jane Doe', email: 'jane@example.com' },
      organization: null,
      scopes: ['openid', 'profile'],
      permissions: [],
      grantedAt: '2026-07-01T12:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
      status: 'active',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/applications/app-1' && method === 'GET') {
        return Promise.resolve(jsonResponse(application))
      }
      if (url === '/api/application-authorizations?applicationId=app-1&limit=50&offset=0' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            authorizations: active ? [authorization] : [],
            pagination: {
              limit: 50,
              offset: 0,
              total: active ? 1 : 0,
              hasMore: false,
              nextOffset: null,
            },
          }),
        )
      }
      if (url === '/api/application-authorizations/authorization-1/revocation' && method === 'PUT') {
        revocations += 1
        active = false
        return Promise.resolve(
          jsonResponse({
            applicationAuthorizationId: 'authorization-1',
            revokedAt: '2026-07-02T12:00:00.000Z',
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="authorizations" />)

    expect(await screen.findByText('Jane Doe')).toBeTruthy()
    expect(screen.getByText('jane@example.com')).toBeTruthy()
    expect(screen.getByText('openid')).toBeTruthy()
    expect(screen.getByText('Does not expire')).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Last used' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByText(/Jane Doe’s approval/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke authorization' }))
    expect(await screen.findByText('No active authorizations')).toBeTruthy()
    expect(revocations).toBe(1)
  })

  it('uses section-level editors for application OAuth, claims, consent, and lifecycle settings [spec: admin-console/admin-application-detail] [spec: admin-console/admin-application-oidc-claims]', async () => {
    const requests: Array<{ url: string; body: unknown; method: string }> = []
    let currentApplication = application
    let deleted = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/applications/app-1' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        requests.push({ url, method, body })
        currentApplication = { ...currentApplication, ...body }
        return Promise.resolve(jsonResponse(currentApplication))
      }
      if (url === '/api/applications/app-1' && method === 'DELETE') {
        requests.push({ url, method, body: null })
        deleted = true
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (deleted && url.startsWith('/api/applications/app-1')) {
        throw new Error(`Removed application detail was refetched: ${method} ${url}`)
      }
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(currentApplication))
      if (url === '/api/applications/app-1/federated-credentials') {
        return Promise.resolve(jsonResponse({ credentials: [] }))
      }
      if (url === '/api/api-resources') {
        return Promise.resolve(jsonResponse({ items: [], pagination: { ...pagination, total: 0 } }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByText('Public SPA · client-1')).toBeTruthy()
    expect(screen.getByText('All Realm users')).toBeTruthy()
    expect(screen.getByText('Platform-owned')).toBeTruthy()
    expect(screen.getByText('Skipped for this trusted application')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'OAuth',
      'Authorizations',
      'Settings',
    ])

    cleanup()
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)
    await screen.findByRole('heading', { name: 'Customer portal' })
    const redirects = screen.getByRole('heading', { name: 'Redirects and origins' }).closest('section') as HTMLElement
    expect(within(redirects).getByText('https://app.example.com/callback')).toBeTruthy()
    fireEvent.click(within(redirects).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Redirect URIs'), {
      target: { value: 'https://new.example.com/callback' },
    })
    fireEvent.change(screen.getByLabelText('Post sign-out redirects'), {
      target: { value: 'https://new.example.com/signed-out' },
    })
    fireEvent.change(screen.getByLabelText('CORS origins'), {
      target: { value: 'https://new.example.com\nhttp://localhost:4173' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: {
          redirectUris: ['https://new.example.com/callback'],
          postLogoutRedirectUris: ['https://new.example.com/signed-out'],
          corsOrigins: ['https://new.example.com', 'http://localhost:4173'],
        },
      }),
    )

    const authorization = screen.getByRole('heading', { name: 'Authorization' }).closest('section') as HTMLElement
    fireEvent.click(within(authorization).getByRole('button', { name: 'Edit' }))
    expect(screen.queryByRole('checkbox', { name: 'Client credentials' })).toBeNull()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Refresh token' }))
    expect(screen.getByRole('checkbox', { name: 'Offline access' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Offline access' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: {
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
          allowedScopes: ['openid', 'profile', 'offline_access'],
        },
      }),
    )

    const claims = screen.getByRole('heading', { name: 'Token claims' }).closest('section') as HTMLElement
    fireEvent.click(within(claims).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'ID token roles' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: {
          oidcClaims: {
            ...application.oidcClaims,
            idToken: { roles: true },
          },
        },
      }),
    )

    cleanup()
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="settings" />)
    await screen.findByRole('heading', { name: 'Customer portal' })
    const consent = screen.getByRole('heading', { name: 'User consent' }).closest('section') as HTMLElement
    fireEvent.click(within(consent).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Publisher relationship'), { target: { value: 'third-party' } })
    fireEvent.click(screen.getByText('Require user consent'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: { firstParty: false, trusted: false },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disable application' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: { disabled: true, disabledReason: 'Disabled by Realm operator' },
      }),
    )
    expect(await screen.findByRole('button', { name: 'Enable application' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    expect(await screen.findByRole('heading', { name: 'Delete application' })).toBeTruthy()
    expect(screen.getByText(/Deleting Customer portal/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete application' }))
    await waitFor(() => expect(deleted).toBe(true))
  })

  it('shows only metadata for existing confidential secrets and discloses a rotated secret once', async () => {
    const confidentialApplication = {
      ...application,
      clientType: 'confidential_web',
      public: false,
      requirePkce: false,
      tokenEndpointAuthMethod: 'client_secret_basic',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/applications/app-1/client-secrets') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            clientSecret: 'fas_rotated_secret',
            secret: {
              id: 'secret-2',
              version: 2,
              prefix: 'fas_rotated',
              status: 'active',
              createdAt: '2026-01-02T00:00:00.000Z',
              expiresAt: null,
              revokedAt: null,
            },
          }),
        )
      }
      if (url.startsWith('/api/applications/app-1/client-secrets')) {
        return Promise.resolve(
          jsonResponse({
            secrets: [
              {
                id: 'secret-1',
                version: 1,
                prefix: 'fas_existing',
                status: 'active',
                createdAt: '2026-01-01T00:00:00.000Z',
                expiresAt: null,
                revokedAt: null,
              },
            ],
            pagination,
          }),
        )
      }
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(confidentialApplication))
      if (url === '/api/applications/app-1/federated-credentials') {
        return Promise.resolve(jsonResponse({ credentials: [] }))
      }
      if (url === '/api/api-resources') {
        return Promise.resolve(jsonResponse({ items: [], pagination: { ...pagination, total: 0 } }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)

    expect(await screen.findByText(/Version 1 · created/)).toBeTruthy()
    expect(screen.queryByText('fas_existing')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    const confirmation = await screen.findByRole('alertdialog', { name: 'Rotate client secret?' })
    expect(within(confirmation).getByText(/current client secret will stop working immediately/i)).toBeTruthy()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Rotate secret' }))
    expect(await screen.findByText('fas_rotated_secret')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]!)
    await waitFor(() => expect(screen.queryByText('fas_rotated_secret')).toBeNull())
  })
})
