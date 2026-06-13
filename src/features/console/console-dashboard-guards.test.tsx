import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsoleDashboardPage } from '@/features/console/pages/dashboard-page'
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
  role,
  securityPolicy,
  signInSettings,
  user,
} from './console.test-utils'

describe('console dashboard guards', () => {
  it('renders dashboard metrics and recent operational state', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      if (url === '/api/management/applications/app-1') {
        return Promise.resolve(jsonResponse(application))
      }
      if (url.startsWith('/api/management/users')) return Promise.resolve(jsonResponse({ users: [user], pagination }))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url.startsWith('/api/management/roles')) return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Total users')).toBeTruthy()
    expect(screen.getByText('New users today')).toBeTruthy()
    expect(screen.getByText('New users past 7 days')).toBeTruthy()
    expect(screen.getAllByText('Pending')).toHaveLength(4)
    expect(screen.getByText('Daily active users')).toBeTruthy()
    expect(screen.getByText('Weekly active users')).toBeTruthy()
    expect(screen.getByText('Monthly active users')).toBeTruthy()
    expect(metricValue('Total users')).toBe('1')
    expect(metricValue('New users today')).toBe('--')
    expect(metricValue('New users past 7 days')).toBe('--')
    expect(screen.getByText('Pending activity data')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Daily active users trend' })).toBeTruthy()
  })

  it('renders dashboard empty metrics without setup marketing cards', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/roles')
        return Promise.resolve(jsonResponse({ roles: [], pagination: emptyPagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') {
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
    expect(metricValue('Total users')).toBe('0')
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(5)
    expect(screen.getAllByText('Pending')).toHaveLength(4)
    expect(screen.queryByText('Setup progress')).toBeNull()
    expect(screen.queryByText('Private cloud')).toBeNull()
  })

  it('renders dashboard load errors with retry action', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ error: { message: 'Management unavailable.' } }, 503))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/roles')) {
        return Promise.resolve(jsonResponse({ roles: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByText('Management unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(requests.filter((url) => url === '/api/management/applications').length).toBe(2))
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

  it('redirects signed-out Console routes before management requests start', async () => {
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
    expect(requests.filter((url) => url.startsWith('/api/management'))).toEqual([])
  })

  it('redirects signed-in non-admin Console routes before management requests start', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ user: { ...consoleAccountProfile, role: 'user' } }))
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/console/dashboard')

    render(<AppRouter />)

    await waitFor(() => expect(window.location.pathname).toBe('/profile'))
    expect(requests.filter((url) => url.startsWith('/api/management'))).toEqual([])
  })
})
