import { type ApplicationResponse, deviceCodeGrantType } from '@shared/api/applications'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'
import { UsersPage } from '@/features/console/extracted/users/users-list'
import { queryClient } from '@/router'

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

import {
  application,
  configz,
  consoleAccountAccess,
  consoleAccountProfile,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  pagination,
  renderWithQuery,
  signInSettings,
  user,
} from './console.test-utils'

describe('admin console applications-detail-b', () => {
  it('retries application detail loading failures', async () => {
    const requests: string[] = []
    let detailAttempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/configuration-status') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/applications', missing: [] } }),
        )
      }
      if (url === '/api/applications/app-1') {
        detailAttempts += 1
        if (detailAttempts === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Application unavailable.' } }, 503))
        }
        return Promise.resolve(jsonResponse(application))
      }
      if (url === '/api/applications/app-1/client-secrets') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByText('Application unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Resource access' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'User authorizations' })).toBeTruthy()
    expect(requests.filter((url) => url === '/api/applications/app-1')).toHaveLength(2)
  })

  it('keeps application detail rendering stable when optional list fields are empty', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/configuration-status') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/applications', missing: [] } }),
        )
      }
      if (url === '/api/applications/app-1') {
        return Promise.resolve(
          jsonResponse({
            ...application,
            corsOrigins: [],
            postLogoutRedirectUris: [],
            redirectUris: [],
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    const redirects = screen.getByRole('heading', { name: 'Redirects and origins' }).closest('section') as HTMLElement
    fireEvent.click(redirects.querySelector('button') as HTMLButtonElement)
    expect(screen.getByLabelText('Redirect URIs')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Post sign-out redirects')).toHaveProperty('value', '')
    expect(screen.getByLabelText('CORS origins')).toHaveProperty('value', '')
  })

  it('renders application detail mutation errors at the operation boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ user: consoleAccountProfile, access: consoleAccountAccess }))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/configuration-status') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/applications', missing: [] } }),
        )
      }
      if (url === '/api/applications/app-1' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Redirect URI is not allowed.' } }, 400))
      }
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    const redirects = screen.getByRole('heading', { name: 'Redirects and origins' }).closest('section') as HTMLElement
    fireEvent.click(redirects.querySelector('button') as HTMLButtonElement)
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://bad.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect((await screen.findAllByText('Redirect URI is not allowed.')).length).toBeGreaterThan(0)
  })

  it('renders ownership, consent, and native-client variants across detail sections', async () => {
    const updateRequests: unknown[] = []
    let currentApplication = {
      ...application,
      description: null,
      homepageUrl: null,
      consentRequired: true,
    } as ApplicationResponse
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        updateRequests.push(body)
        currentApplication = {
          ...currentApplication,
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
        }
        return Promise.resolve(jsonResponse(currentApplication))
      }
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(currentApplication))
      if (url === '/api/applications/app-1/federated-credentials') {
        return Promise.resolve(jsonResponse({ items: [] }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
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

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" organizationId="org-1" />)
    expect(await screen.findByText('Required')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('heading', { name: 'User consent' })).toBeTruthy()

    cleanup()
    queryClient.clear()
    currentApplication = { ...currentApplication }
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)
    expect(await screen.findByText('Required')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('heading', { name: 'Application details' })).toBeTruthy()
    const details = screen.getByRole('heading', { name: 'Application details' }).closest('section') as HTMLElement
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Description')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Homepage URL')).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const consent = screen.getByRole('heading', { name: 'User consent' }).closest('section') as HTMLElement
    fireEvent.click(within(consent).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Require user consent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const visibility = screen.getByRole('heading', { name: 'Visibility' }).closest('section') as HTMLElement
    fireEvent.click(within(visibility).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByText('Private'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateRequests).toContainEqual({ visibility: 'private' }))
    updateRequests.length = 0
    fireEvent.click(within(visibility).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Public/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateRequests).toContainEqual({ visibility: 'public' }))
    updateRequests.length = 0

    cleanup()
    queryClient.clear()
    currentApplication = {
      ...currentApplication,
      visibility: 'private',
      clientType: 'public_native',
      allowedGrantTypes: ['authorization_code', 'refresh_token', deviceCodeGrantType],
      oidcScopes: ['openid', 'profile', 'email', 'offline_access'],
    }
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="settings" />)
    expect(await screen.findByText('Only active members of the owner Organization may sign in.')).toBeTruthy()
    cleanup()
    queryClient.clear()
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)
    const authorization = (await screen.findByRole('heading', { name: 'Authorization' })).closest(
      'section',
    ) as HTMLElement
    expect(within(authorization).getByText((text) => text.includes(deviceCodeGrantType))).toBeTruthy()
    fireEvent.click(within(authorization).getByRole('button', { name: 'Edit' }))
    expect(within(screen.getByRole('dialog')).queryByText('Grant types')).toBeNull()
    const deviceLogin = screen.getByRole('switch', { name: 'Device login' })
    expect(deviceLogin.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(deviceLogin)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(updateRequests).toEqual([
        {
          deviceLoginEnabled: false,
          resourceScopes: [],
        },
      ]),
    )
  })

  it('retries and revokes an authorization from the first page', async () => {
    let attempts = 0
    let active = true
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      if (url === '/api/applications/app-1/authorizations?status=active&limit=50&offset=0') {
        attempts += 1
        if (attempts === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Authorizations unavailable.' } }, 503))
        }
        return Promise.resolve(
          jsonResponse({
            items: active
              ? [
                  {
                    id: 'authorization-1',
                    applicationId: 'app-1',
                    resourceServerId: null,
                    user: { id: 'user-1', displayName: 'Jane Doe', email: 'jane@example.com' },
                    scopes: ['openid'],
                    grantedAt: '2026-07-01T12:00:00.000Z',
                    expiresAt: null,
                    revokedAt: null,
                    status: 'active',
                  },
                ]
              : [],
            pagination: { ...emptyPagination, total: active ? 1 : 0 },
          }),
        )
      }
      if (url === '/api/applications/app-1/authorizations/authorization-1' && init?.method === 'DELETE') {
        active = false
        return Promise.resolve(
          jsonResponse({ applicationAuthorizationId: 'authorization-1', revokedAt: '2026-07-02T00:00:00.000Z' }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="authorizations" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke authorization' }),
    )
    expect(await screen.findByText('No active authorizations')).toBeTruthy()
  })

  it('shows Resource access only for an Application machine principal', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input).split('?')[0]!
      if (url === '/api/applications/app-1') {
        return Promise.resolve(
          jsonResponse({
            ...application,
            clientType: 'machine',
            public: false,
            allowedGrantTypes: ['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange'],
            oidcScopes: [],
            redirectUris: [],
            tokenEndpointAuthMethod: 'client_secret_basic',
          }),
        )
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [assignedResource], pagination }))
      }
      if (url === '/api/applications/app-1/permissions') {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'asg-1',
                applicationId: 'app-1',
                resourceServerId: 'resource-1',
                scope: 'projects:admin',
                mode: 'persistent',
                status: 'active',
                grantedBy: { type: 'user', id: 'admin-1' },
                expiresAt: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                links: {
                  self: '/api/applications/app-1/permissions/asg-1',
                  resourceServer: '/api/resource-servers/resource-1',
                },
              },
            ],
            pagination,
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="permissions" />)

    expect(await screen.findByRole('tab', { name: 'Resource access' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'User authorizations' })).toBeNull()
    expect(await screen.findByText('Projects API')).toBeTruthy()
    expect(screen.getByText('projects:admin')).toBeTruthy()

    cleanup()
    queryClient.clear()
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)
    expect(await screen.findByRole('heading', { name: 'Authorization' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Redirects and origins' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Token claims' })).toBeNull()
    expect(screen.getByText('Machine-to-machine · client-1')).toBeTruthy()
  })

  it('renders users and displays management API errors from create flow', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/users' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Email already exists.' } }, 400))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ items: [user], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeTruthy()
    expect(screen.queryByRole('columnheader', { name: 'Realm access' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Email already exists.')).toBeTruthy()
  })

  it('rejects an Application detail route under a different Organization', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" organizationId="org-other" />)

    expect(await screen.findByText('Application does not belong to this Organization.')).toBeTruthy()
  })
})

const assignedResource = {
  id: 'resource-1',
  identifier: 'projects',
  name: 'Projects API',
  resourceUrl: 'https://api.example.com',
  connectorId: null,
  authorizationDetails: [],
  description: null,
  enabled: true,
  ownerOrganizationId: 'org-1',
  visibility: 'public',
  scopeRegistry: {
    discovery: {
      sourceUrl: 'https://api.example.com/openapi.json',
      etag: null,
      documentHash: 'hash',
      syncedAt: '2026-01-01T00:00:00.000Z',
      lastError: null,
    },
    scopes: [{ value: 'projects:admin', description: null, grantMode: 'assigned' }],
  },
  availableToAgents: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
