import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { queryClientDefaultOptions } from '@/lib/query-client'
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
  consoleAccountAccess,
  consoleAccountProfile,
  consolePasskey,
  consoleRouteFetch,
  consoleSecurity,
  consoleSession,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  linkedAccount,
  organization,
  pagination,
  profile,
  role,
  signInSettings,
  userApplication,
} from './console.test-utils'

describe('console route navigation', () => {
  it('allows protected Console routes while setup checklist is incomplete [spec: admin-console/admin-setup-gate]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ user: consoleAccountProfile, access: consoleAccountAccess }))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/realm/configuration-status') {
        return Promise.resolve(
          jsonResponse({
            admin: { setupRequired: true, setupHref: '/console/onboarding', missing: ['oidc_application'] },
          }),
        )
      }
      if (url === '/api/applications') return Promise.resolve(jsonResponse({ applications: [], pagination }))
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/console/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/applications'))
  })

  it('renders canonical Console routes and current nested defaults [spec: admin-console/admin-route-backed-navigation]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)

    for (const [path, finalPath, heading] of [
      ['/console', '/console', 'Dashboard'],
      ['/console/applications', '/console/applications', 'Applications'],
      ['/console/sign-in-experience', '/console/sign-in-experience/theme', 'Experience'],
      ['/console/sign-in-experience/sign-in', '/console/sign-in-experience/sign-in', 'Sign-in & registration'],
      ['/console/sign-in-experience/theme', '/console/sign-in-experience/theme', 'Experience'],
      ['/console/sign-in-experience/assets', '/console/sign-in-experience/assets', 'Experience'],
      ['/console/sign-in-experience/legal', '/console/sign-in-experience/legal', 'Experience'],
      ['/console/sign-in-experience/account-center', '/console/sign-in-experience/account-center', 'Account Center'],
      ['/console/sign-in-experience/content', '/console/sign-in-experience/content', 'Experience'],
      ['/console/security', '/console/security/sign-in', 'Security policies'],
      ['/console/security/sign-in', '/console/security/sign-in', 'Security policies'],
      ['/console/security/mfa', '/console/security/mfa', 'Security policies'],
      ['/console/security/abuse', '/console/security/abuse', 'Security policies'],
      ['/console/connectors', '/console/connectors', 'Identity providers'],
      ['/console/webhooks', '/console/webhooks/endpoints', 'Webhooks'],
      ['/console/webhooks/endpoints', '/console/webhooks/endpoints', 'Webhooks'],
      ['/console/webhooks/requests', '/console/webhooks/requests', 'Webhooks'],
      ['/console/tenant-settings', '/console/tenant-settings/general', 'Settings'],
      ['/console/tenant-settings/general', '/console/tenant-settings/general', 'Settings'],
    ] as const) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect((await screen.findAllByRole('heading', { name: heading })).length).toBeGreaterThan(0)
      await waitFor(() => expect(window.location.pathname).toBe(finalPath))
      expect(screen.getByRole('navigation', { name: 'Console' })).toBeTruthy()

      cleanup()
      queryClient.clear()
    }
  }, 15_000)

  it('navigates Experience tabs through routable tab controls [spec: admin-console/admin-sign-in-experience-routes]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/sign-in-experience/theme')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Experience' })).toBeTruthy()

    for (const [label, path] of [
      ['Brand assets', '/console/sign-in-experience/assets'],
      ['Legal & support', '/console/sign-in-experience/legal'],
      ['Color scheme', '/console/sign-in-experience/theme'],
    ] as const) {
      await userEvent.click(await screen.findByRole('tab', { name: label }))

      await waitFor(() => expect(window.location.pathname).toBe(path))
      expect((await screen.findAllByRole('heading', { name: 'Experience' })).length).toBeGreaterThan(0)
      expect(screen.getByRole('tab', { name: label }).getAttribute('aria-selected')).toBe('true')
    }
    expect(screen.queryByRole('tab', { name: 'Desktop' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Mobile' })).toBeNull()
  })

  it('does not repeat fresh guard and page queries while switching Experience tabs', async () => {
    queryClient.setDefaultOptions(queryClientDefaultOptions)
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/sign-in-experience/theme')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Experience' })).toBeTruthy()
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(7))
    fetchSpy.mockClear()

    await userEvent.click(screen.getByRole('tab', { name: 'Brand assets' }))

    await waitFor(() => expect(window.location.pathname).toBe('/console/sign-in-experience/assets'))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps Sign-in & registration separate from Experience navigation', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/sign-in-experience/sign-in')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign-in & registration' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Experience' })).toHaveProperty(
      'href',
      `${window.location.origin}/console/sign-in-experience/theme`,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Experience' }))

    expect(await screen.findByRole('heading', { name: 'Experience' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/sign-in-experience/theme'))
  })

  it('renders authorization detail routes with route params', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ user: consoleAccountProfile, access: consoleAccountAccess }))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/realm/configuration-status') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/applications/app-1') return Promise.resolve(jsonResponse(application))
      if (url === '/api/applications/app-1/client-secrets') {
        return Promise.resolve(jsonResponse({ secrets: [], pagination: emptyPagination }))
      }
      if (url === '/api/users/user-1') {
        return Promise.resolve(jsonResponse({ user: { ...profile, role: 'admin', banned: false } }))
      }
      if (url.startsWith('/api/users/user-1/sessions')) {
        return Promise.resolve(jsonResponse({ sessions: [consoleSession], pagination }))
      }
      if (url.startsWith('/api/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [linkedAccount], pagination }))
      }
      if (url.startsWith('/api/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [userApplication], pagination }))
      }
      if (url === '/api/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      }
      if (url.startsWith('/api/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [consolePasskey], pagination }))
      }
      if (url === '/api/organizations/org-1/roles/role-1') {
        return Promise.resolve(
          jsonResponse({
            ...role,
            key: 'role-1',
            predefined: false,
            scopes: [{ resourceId: 'resource-1', scope: 'orders.read' }],
          }),
        )
      }
      if (url === '/api/organizations/org-1/roles') {
        return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
      }
      if (url === '/api/resource-servers/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/organizations/org-1') return Promise.resolve(jsonResponse(organization))
      if (url.startsWith('/api/organizations/org-1/members')) {
        return Promise.resolve(jsonResponse({ members: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/organizations/org-1/invitations')) {
        return Promise.resolve(jsonResponse({ invitations: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/agents?')) {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/agents/agent-1') {
        return Promise.resolve(
          jsonResponse({
            agent: {
              id: 'agent-1',
              issuer: 'https://identity.acme.dev',
              subject: 'agt_build',
              name: 'Build Agent',
              homeSpace: { type: 'organization', organizationId: 'org-1' },
              owner: { id: 'org-1', type: 'organization', displayName: 'Acme' },
              status: 'active',
              installationCount: 1,
              pendingRequestCount: 0,
              activeResourceCount: 1,
              activeScopeCount: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        )
      }
      if (
        url.startsWith('/api/agents/agent-1/installations') ||
        url.startsWith('/api/access/requests?agentId=agent-1') ||
        url.startsWith('/api/agents/agent-1/scope-entitlements')
      ) {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/realm/audit-events?')) {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    window.history.pushState(null, '', '/console/users/user-1?context=org-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/users/user-1/overview')
    expect(window.location.search).toBe('')
    expect(screen.getByRole('tab', { name: 'Authentication' })).toBeTruthy()

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/api-resources/resource-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/api-resources/resource-1/overview')

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/agents/agent-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/agents/agent-1/overview')
  })
})
