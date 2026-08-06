import type { ApplicationResponse } from '@shared/api/applications'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
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
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
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
        return Promise.resolve(jsonResponse({ secrets: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByText('Application unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(requests.filter((url) => url === '/api/applications/app-1')).toHaveLength(2)
  })

  it('keeps application detail rendering stable when optional list fields are empty', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/configuration-status') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
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
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
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
    let currentApplication = {
      ...application,
      description: null,
      homepageUrl: null,
      firstParty: false,
      trusted: false,
    } as ApplicationResponse
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(currentApplication))
      if (url === '/api/applications/app-1/federated-credentials') {
        return Promise.resolve(jsonResponse({ credentials: [] }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" organizationId="org-1" />)
    expect(await screen.findByText('Any authenticated user')).toBeTruthy()
    expect(screen.getByText('Third-party')).toBeTruthy()
    expect(screen.getByText('Required')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Any authenticated user')).toBeTruthy()

    cleanup()
    queryClient.clear()
    currentApplication = { ...currentApplication }
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)
    expect(await screen.findByText('Any authenticated user')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Settings' }), { button: 0, ctrlKey: false })
    expect(await screen.findByRole('heading', { name: 'Application details' })).toBeTruthy()
    const details = screen.getByRole('heading', { name: 'Application details' }).closest('section') as HTMLElement
    fireEvent.click(within(details).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Description')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Homepage URL')).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const consent = screen.getByRole('heading', { name: 'User consent' }).closest('section') as HTMLElement
    fireEvent.click(within(consent).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByLabelText('Publisher relationship')).toHaveProperty('value', 'third-party')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    cleanup()
    queryClient.clear()
    currentApplication = {
      ...currentApplication,
      clientType: 'public_native',
      allowedGrantTypes: ['authorization_code', 'refresh_token'],
      oidcScopes: ['openid', 'profile', 'offline_access'],
    }
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="oauth" />)
    const authorization = (await screen.findByRole('heading', { name: 'Authorization' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(authorization).getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('checkbox', { name: 'Device code' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Refresh token' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Refresh token' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('retries and revokes an authorization from the first page', async () => {
    let attempts = 0
    let active = true
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      if (url === '/api/access/consents?applicationId=app-1&limit=50&offset=0') {
        attempts += 1
        if (attempts === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Authorizations unavailable.' } }, 503))
        }
        return Promise.resolve(
          jsonResponse({
            authorizations: active
              ? [
                  {
                    id: 'authorization-1',
                    applicationId: 'app-1',
                    resourceServerId: null,
                    user: { id: 'user-1', displayName: 'Jane Doe', email: 'jane@example.com' },
                    organization: null,
                    scopes: ['openid'],
                    permissions: [],
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
      if (url === '/api/access/consents/authorization-1/revocation' && init?.method === 'PUT') {
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

  it('renders users and displays management API errors from create flow', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/users' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Email already exists.' } }, 400))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Realm access' })).toBeTruthy()
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
