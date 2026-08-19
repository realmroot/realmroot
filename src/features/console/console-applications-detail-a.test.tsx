import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'
import { ApplicationsPage } from '@/features/applications/management/applications-list'
import { queryClient } from '@/router'
import {
  apiResource,
  application,
  consoleSharedFetch,
  jsonResponse,
  pagination,
  renderWithQuery,
} from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
Element.prototype.scrollIntoView ??= () => {}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('admin console applications-detail-a', () => {
  it('fails closed for cross-Organization applications and unavailable tabs', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" organizationId="org-other" section="permissions" />)
    expect(await screen.findByText('Application does not belong to this Organization.')).toBeTruthy()

    cleanup()
    vi.mocked(window.fetch).mockImplementation((input, init) => {
      if (String(input) === '/api/applications/app-1') {
        return Promise.resolve(jsonResponse({ ...application, allowedGrantTypes: [] }))
      }
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="permissions" />)
    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('data-state')).toBe('active')
  })

  it('edits Resource Server allowlists across registry and visibility variants', async () => {
    const privateResource = {
      ...apiResource,
      id: 'resource-private',
      name: 'Private API',
      visibility: 'private' as const,
      scopeRegistry: {
        discovery: {
          sourceUrl: 'https://private.example.com/openapi.json',
          etag: null,
          documentHash: 'hash',
          syncedAt: '2026-08-06T00:00:00.000Z',
          lastError: null,
        },
        scopes: [
          { value: 'private:read', description: 'Read private records', grantMode: 'assigned' as const },
          { value: 'private:write', description: null, grantMode: 'assigned' as const },
        ],
      },
    }
    const publicResource = {
      ...apiResource,
      id: 'resource-public',
      name: 'Public API',
      visibility: 'public' as const,
      scopeRegistry: null,
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-1') {
        return Promise.resolve(
          jsonResponse({
            ...application,
            resourceScopes: [{ resourceServerId: privateResource.id, scopes: ['private:read'] }],
          }),
        )
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [privateResource, publicResource], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)
    const authorization = (await screen.findByRole('heading', { name: 'Authorization' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(authorization).getByRole('button', { name: 'Edit' }))
    const readScope = await screen.findByRole('checkbox', { name: /private:read/ })
    expect(screen.getByText('Private Resource Server')).toBeTruthy()
    expect(screen.getByText('Public Resource Server')).toBeTruthy()
    fireEvent.click(readScope)
    fireEvent.click(readScope)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /private:read/ })).toBeNull())
  })

  it('renders the unified application inventory with compact client metadata', async () => {
    const thirdPartyApplication = {
      ...application,
      id: 'app-2',
      clientId: 'partner-client',
      name: 'Partner app',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/applications') {
        return Promise.resolve(jsonResponse({ items: [application, thirdPartyApplication], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    expect(screen.getByText('Partner app')).toBeTruthy()
    expect(screen.getByText('partner-client')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Resource access' })).toBeTruthy()
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
      resourceServerId: null,
      user: { id: 'user-1', displayName: 'Jane Doe', email: 'jane@example.com' },
      scopes: ['openid', 'profile'],
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
      if (url === '/api/applications/app-1/authorizations?status=active&limit=50&offset=0' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            items: active ? [authorization] : [],
            pagination: {
              limit: 50,
              offset: 0,
              total: active ? 51 : 0,
              hasMore: active,
              nextOffset: active ? 50 : null,
            },
          }),
        )
      }
      if (url === '/api/applications/app-1/authorizations?status=active&limit=50&offset=50' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            items: active
              ? [
                  {
                    ...authorization,
                    resourceServerId: 'resource-1',
                    expiresAt: '2027-07-01T12:00:00.000Z',
                  },
                ]
              : [],
            pagination: { limit: 50, offset: 50, total: active ? 51 : 0, hasMore: false, nextOffset: null },
          }),
        )
      }
      if (url === '/api/applications/app-1/authorizations/authorization-1' && method === 'DELETE') {
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
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('OIDC')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true))
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
        return Promise.resolve(jsonResponse({ items: [] }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: { ...pagination, total: 0 } }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(
          jsonResponse({
            items: [{ id: 'org-1', slug: 'realmroot', name: 'Realmroot', disabled: false }],
            pagination,
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByText('Public SPA · client-1')).toBeTruthy()
    expect(screen.getByText('Not required')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'OAuth',
      'User authorizations',
      'Settings',
    ])
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'OAuth' }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('heading', { name: 'Redirects and origins' })).toBeTruthy()

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
    expect(within(screen.getByRole('dialog')).queryByText('Grant types')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: {
          resourceScopes: [],
        },
      }),
    )

    cleanup()
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="settings" />)
    await screen.findByRole('heading', { name: 'Customer portal' })
    const details = screen.getByRole('heading', { name: 'Application details' }).closest('section') as HTMLElement
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Updated portal' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Updated client' } })
    fireEvent.change(screen.getByLabelText('Homepage URL'), { target: { value: 'https://portal.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: {
          name: 'Updated portal',
          description: 'Updated client',
          homepageUrl: 'https://portal.example.com',
        },
      }),
    )

    const ownership = screen.getByRole('heading', { name: 'Ownership' }).closest('section') as HTMLElement
    expect(within(ownership).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(ownership).getByText('The owner Organization is fixed when this client is created.')).toBeTruthy()

    const consent = screen.getByRole('heading', { name: 'User consent' }).closest('section') as HTMLElement
    fireEvent.click(within(consent).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByText('Require user consent'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: { consentRequired: true },
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
    fireEvent.click(screen.getByRole('button', { name: 'Enable application' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/applications/app-1',
        method: 'PATCH',
        body: { disabled: false, disabledReason: null },
      }),
    )

    cleanup()
    queryClient.clear()
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" organizationId="org-1" section="settings" />)
    await screen.findByRole('heading', { name: 'Updated portal' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    expect(await screen.findByRole('heading', { name: 'Delete application' })).toBeTruthy()
    expect(screen.getByText(/Deleting Updated portal/)).toBeTruthy()
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
            items: [
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
        return Promise.resolve(jsonResponse({ items: [] }))
      }
      if (url === '/api/resource-servers') {
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
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    const confirmed = await screen.findByRole('alertdialog', { name: 'Rotate client secret?' })
    fireEvent.click(within(confirmed).getByRole('button', { name: 'Rotate secret' }))
    expect(await screen.findByText('fas_rotated_secret')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]!)
    await waitFor(() => expect(screen.queryByText('fas_rotated_secret')).toBeNull())
  })

  it('returns to the global Application collection after deletion', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-1' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      return consoleSharedFetch(input, init)
    })

    const { router } = renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="settings" />)
    await screen.findByRole('heading', { name: 'Customer portal' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete application' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/console/applications'))
  })
})
