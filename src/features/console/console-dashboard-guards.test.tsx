import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleDashboardPage } from '@/features/console/pages/dashboard-page'
import { ConsoleScopeProvider } from '@/lib/console-context'
import { AppRouter, queryClient } from '@/router'

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
  apiResource,
  application,
  brandingSettings,
  configz,
  connector,
  consoleAccountProfile,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  metricValue,
  organization,
  pagination,
  renderWithQuery,
  securityPolicy,
  signInSettings,
  user,
} from './console.test-utils'

describe('console dashboard guards', () => {
  it('derives Organization next steps and ready state from contextual inventory', async () => {
    let populated = false
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin)
      const items = populated ? [{}] : []
      const contextualPagination = { ...emptyPagination, total: items.length }
      if (url.pathname === '/api/organizations/org-1') {
        return Promise.resolve(
          jsonResponse(populated ? { ...organization, displayName: null, name: 'Acme' } : organization),
        )
      }
      if (url.pathname === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: items, pagination: contextualPagination }))
      }
      if (url.pathname === '/api/users') {
        return Promise.resolve(jsonResponse({ users: items, pagination: contextualPagination }))
      }
      if (url.pathname === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items, pagination: contextualPagination }))
      }
      if (url.pathname === '/api/agents') {
        return Promise.resolve(jsonResponse({ items, pagination: contextualPagination }))
      }
      if (url.pathname === '/api/organizations/org-1/roles') {
        return Promise.resolve(jsonResponse({ roles: items, pagination: contextualPagination }))
      }
      throw new Error(`Unexpected Organization dashboard request: ${request?.method ?? init?.method ?? 'GET'} ${url}`)
    })

    const empty = renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <ConsoleDashboardPage />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Acme Inc.' })).toBeTruthy()
    expect(screen.getByText('Register an application')).toBeTruthy()
    expect(screen.getByText('Register a resource server')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Register an application' }).getAttribute('href')).toContain(
      'context=org-1',
    )
    empty.unmount()

    populated = true
    renderWithQuery(
      <ConsoleScopeProvider value={{ organizationId: 'org-1', realmOperator: false }}>
        <ConsoleDashboardPage />
      </ConsoleScopeProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(screen.getByText('Development inventory is ready')).toBeTruthy()
  })

  it('renders dashboard metrics and recent operational state [spec: admin-console/admin-dashboard]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      if (url === '/api/applications/app-1') {
        return Promise.resolve(jsonResponse(application))
      }
      if (url.startsWith('/api/users')) return Promise.resolve(jsonResponse({ users: [user], pagination }))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      if (url.startsWith('/api/organizations')) {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
      }
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/realm/security-policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(metricValue('Users')).toBe('1')
    expect(metricValue('Applications')).toBe('1')
    expect(metricValue('Resource servers')).toBe('1')
    expect(metricValue('Organizations')).toBe('1')
    expect(screen.getByText('Realm readiness')).toBeTruthy()
    expect(screen.getByText('3 available')).toBeTruthy()
    expect(screen.getByText('1 ready')).toBeTruthy()
    expect(screen.getByText('No overview gaps')).toBeTruthy()
  })

  it('renders dashboard empty metrics without setup marketing cards', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/organizations')) {
        return Promise.resolve(jsonResponse({ organizations: [], pagination: emptyPagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/security-policy') {
        return Promise.resolve(
          jsonResponse({
            policy: {
              ...securityPolicy.policy,
              mfa: { mode: 'optional' },
              passkeys: { ...securityPolicy.policy.passkeys, enabled: false },
            },
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(metricValue('Users')).toBe('0')
    expect(metricValue('Applications')).toBe('0')
    expect(metricValue('Resource servers')).toBe('0')
    expect(metricValue('Organizations')).toBe('0')
    expect(screen.getByText('Register an application')).toBeTruthy()
    expect(screen.getByText('Register a resource server')).toBeTruthy()
    expect(screen.queryByText('Enable a sign-in method')).toBeNull()
    expect(screen.queryByText('Setup progress')).toBeNull()
    expect(screen.queryByText('Private cloud')).toBeNull()
  })

  it('renders dashboard load errors with retry action', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ error: { message: 'Management unavailable.' } }, 503))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/organizations')) {
        return Promise.resolve(jsonResponse({ organizations: [], pagination: emptyPagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByText('Management unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(requests.filter((url) => url === '/api/applications').length).toBe(2))
  })

  it('shows the loading state before the dashboard query resolves', async () => {
    const deferred: { resolve: (value: Response) => void } = { resolve: () => {} }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        return new Promise<Response>((resolve) => {
          deferred.resolve = resolve
        })
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/organizations')) {
        return Promise.resolve(jsonResponse({ organizations: [], pagination: emptyPagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByText('Loading Console dashboard')).toBeTruthy()
    deferred.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
    await waitFor(() => expect(screen.queryByText('Loading Console dashboard')).toBeNull())
  })

  it('surfaces non-auth account guard errors instead of converting them to sign-in redirects', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ error: 'Profile unavailable.' }, 503))
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/profile')

    render(<AppRouter />)

    expect(await screen.findByText('Profile unavailable.')).toBeTruthy()
    expect(window.location.pathname).toBe('/profile')
  })

  it('redirects signed-out Console routes before management requests start [spec: admin-console/admin-signed-out-redirect]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ error: 'Unauthorized' }, 401))
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/console/dashboard')

    render(<AppRouter />)

    await waitFor(() => expect(window.location.pathname).toBe('/auth/sign-in'))
    expect(new URLSearchParams(window.location.search).get('return_to')).toContain('/console/dashboard')
    expect(requests.filter((url) => url.startsWith('/api') && !url.startsWith('/api/account/'))).toEqual([
      '/api/configz',
    ])
  })

  it('redirects signed-in non-admin Console routes before management requests start', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/account/profile')
        return Promise.resolve(
          jsonResponse({
            user: { ...consoleAccountProfile, role: 'user' },
          }),
        )
      if (url === '/api/account/developer-console-access') {
        return Promise.resolve(
          jsonResponse({
            canCreateOrganization: true,
            showOrganizations: false,
            realmOperator: false,
            consoleOrganizations: [],
          }),
        )
      }
      if (url === '/api/account/organization-context') {
        return Promise.resolve(jsonResponse({ activeOrganizationId: null }))
      }
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/console/dashboard')

    render(<AppRouter />)

    await waitFor(() => expect(window.location.pathname).toBe('/profile'))
    expect(
      requests.filter((url) => url.startsWith('/api') && !url.startsWith('/api/account/') && url !== '/api/configz'),
    ).toEqual([])
  })
})
