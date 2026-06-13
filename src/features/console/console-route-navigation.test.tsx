import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  apiPermission,
  apiResource,
  apiScope,
  application,
  brandingSettings,
  configz,
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
  user,
  userApplication,
} from './console.test-utils'

describe('console route navigation', () => {
  it('allows protected Console routes while setup checklist is incomplete [spec: admin-console/admin-setup-gate]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({
            admin: { setupRequired: true, setupHref: '/console/onboarding', missing: ['oidc_application'] },
          }),
        )
      }
      if (url === '/api/management/applications') return Promise.resolve(jsonResponse({ applications: [], pagination }))
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
      ['/console/sign-in-experience', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
      [
        '/console/sign-in-experience/sign-up-and-sign-in',
        '/console/sign-in-experience/sign-up-and-sign-in',
        'Sign-up and sign-in',
      ],
      ['/console/sign-in-experience/branding', '/console/sign-in-experience/branding', 'Branding'],
      ['/console/sign-in-experience/account-center', '/console/sign-in-experience/account-center', 'Account Center'],
      ['/console/sign-in-experience/content', '/console/sign-in-experience/content', 'Content'],
      ['/console/security', '/console/security/captcha', 'CAPTCHA'],
      ['/console/security/captcha', '/console/security/captcha', 'CAPTCHA'],
      ['/console/security/blocklist', '/console/security/blocklist', 'Blocklist'],
      ['/console/security/general', '/console/security/general', 'General security'],
      ['/console/mfa', '/console/mfa', 'Multi-factor authentication'],
      ['/console/connectors', '/console/connectors', 'Connectors'],
      ['/console/organization-template', '/console/organization-template/organization-roles', 'Organization roles'],
      [
        '/console/organization-template/organization-roles',
        '/console/organization-template/organization-roles',
        'Organization roles',
      ],
      ['/console/customize-jwt', '/console/customize-jwt', 'Custom JWT'],
      ['/console/webhooks', '/console/webhooks/endpoints', 'Webhooks'],
      ['/console/webhooks/endpoints', '/console/webhooks/endpoints', 'Webhooks'],
      ['/console/webhooks/requests', '/console/webhooks/requests', 'Webhooks'],
      ['/console/tenant-settings', '/console/tenant-settings/oidc-configs', 'Settings'],
      ['/console/tenant-settings/oidc-configs', '/console/tenant-settings/oidc-configs', 'Settings'],
    ] as const) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect((await screen.findAllByRole('heading', { name: heading })).length).toBeGreaterThan(0)
      await waitFor(() => expect(window.location.pathname).toBe(finalPath))
      expect(screen.getByRole('navigation', { name: 'Console' })).toBeTruthy()

      cleanup()
      queryClient.clear()
    }
  })

  it('navigates sign-in experience tabs through routable tab links [spec: admin-console/admin-sign-in-experience-routes]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/sign-in-experience/sign-up-and-sign-in')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign-up and sign-in' })).toBeTruthy()

    for (const [label, path, heading] of [
      ['Branding', '/console/sign-in-experience/branding', 'Branding'],
      ['Account Center', '/console/sign-in-experience/account-center', 'Account Center'],
      ['Content', '/console/sign-in-experience/content', 'Content'],
      ['Sign-up and sign-in', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
    ] as const) {
      fireEvent.click(screen.getByRole('link', { name: label }))

      await waitFor(() => expect(window.location.pathname).toBe(path))
      expect((await screen.findAllByRole('heading', { name: heading })).length).toBeGreaterThan(0)
      expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page')
    }
    expect(screen.queryByRole('link', { name: 'Desktop' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Mobile' })).toBeNull()
  })

  it('navigates between Sign-in and account tabs from the shared tab bar', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/sign-in-experience/sign-up-and-sign-in')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign-up and sign-in' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Branding' })).toHaveProperty(
      'href',
      `${window.location.origin}/console/sign-in-experience/branding`,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Branding' }))

    expect(await screen.findByRole('heading', { name: 'Branding' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/sign-in-experience/branding'))
  })

  it('renders authorization detail routes with route params', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(application))
      if (url === '/api/management/applications/app-1/client-secrets') {
        return Promise.resolve(jsonResponse({ secrets: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1') {
        return Promise.resolve(jsonResponse({ user: { ...profile, role: 'admin', banned: false } }))
      }
      if (url.startsWith('/api/management/users/user-1/sessions')) {
        return Promise.resolve(jsonResponse({ sessions: [consoleSession], pagination }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [linkedAccount], pagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [userApplication], pagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [consolePasskey], pagination }))
      }
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission] }))
      }
      if (url.startsWith('/api/management/roles')) return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [apiScope], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      if (url === '/api/management/organizations/org-1') return Promise.resolve(jsonResponse(organization))
      return consoleSharedFetch(input, init)
    })

    window.history.pushState(null, '', '/console/roles/role-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/roles/role-1/settings')

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/api-resources/resource-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/api-resources/resource-1/settings')

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/organizations/org-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/organizations/org-1/settings')

    for (const scenario of [
      {
        path: '/console/applications/app-1/branding',
        heading: 'Customer portal',
        tab: 'Branding',
        text: 'Application branding',
        nextTab: 'Settings',
        nextPath: '/console/applications/app-1/settings',
        nextText: 'General settings',
      },
      {
        path: '/console/users/user-1/security',
        heading: 'Jane Stone',
        tab: 'Security',
        text: 'MFA and passkeys',
        nextTab: 'Sessions',
        nextPath: '/console/users/user-1/sessions',
        nextText: 'Sessions',
      },
      {
        path: '/console/users/user-1/applications',
        heading: 'Jane Stone',
        tab: 'Applications',
        text: 'Authorized applications',
        nextTab: 'Linked accounts',
        nextPath: '/console/users/user-1/linked-accounts',
        nextText: 'Linked accounts',
      },
      {
        path: '/console/organizations/org-1/authorization',
        heading: 'Acme',
        tab: 'Authorization',
        text: 'Authorization model',
        nextTab: 'Settings',
        nextPath: '/console/organizations/org-1/settings',
        nextText: 'General',
      },
      {
        path: '/console/roles/role-1/permissions',
        heading: 'Admin',
        tab: 'Permissions',
        text: 'Permission assignment',
        nextTab: 'Assignments',
        nextPath: '/console/roles/role-1/assignments',
        nextText: 'Assign role',
      },
      {
        path: '/console/roles/role-1/assignments',
        heading: 'Admin',
        tab: 'Assignments',
        text: 'Assignments',
        nextTab: 'Settings',
        nextPath: '/console/roles/role-1/settings',
        nextText: 'Role settings',
      },
      {
        path: '/console/api-resources/resource-1/scopes',
        heading: 'Management API',
        tab: 'Scopes',
        text: 'Create scope',
        nextTab: 'Permissions',
        nextPath: '/console/api-resources/resource-1/permissions',
        nextText: 'Create permission',
      },
      {
        path: '/console/api-resources/resource-1/permissions',
        heading: 'Management API',
        tab: 'Permissions',
        text: 'Create permission',
        nextTab: 'Settings',
        nextPath: '/console/api-resources/resource-1/settings',
        nextText: 'Resource settings',
      },
      {
        path: '/console/organization-template/organization-permissions',
        heading: 'Organization template',
        tab: 'Organization permissions',
        text: 'Permission templates use API resources',
        nextTab: 'Organization roles',
        nextPath: '/console/organization-template/organization-roles',
        nextText: 'Admin',
      },
      {
        path: '/console/webhooks/requests',
        heading: 'Webhooks',
        tab: 'Requests',
        text: 'Recent requests',
        nextTab: 'Endpoints',
        nextPath: '/console/webhooks/endpoints',
        nextText: 'Create endpoint',
      },
    ] as const) {
      cleanup()
      queryClient.clear()
      window.history.pushState(null, '', scenario.path)
      render(<AppRouter />)

      expect(await screen.findByRole('heading', { name: scenario.heading })).toBeTruthy()
      let activeRouteTab =
        screen.queryByRole('tab', { name: scenario.tab }) ?? screen.queryByRole('link', { name: scenario.tab })
      if (!activeRouteTab) activeRouteTab = await screen.findByRole('link', { name: scenario.tab })
      expect(activeRouteTab.getAttribute('aria-selected') ?? activeRouteTab.getAttribute('aria-current')).toMatch(
        /^(true|page)$/,
      )
      expect((await screen.findAllByText(scenario.text)).length).toBeGreaterThan(0)
      expect(window.location.pathname).toBe(scenario.path)

      fireEvent.click(
        screen.queryByRole('tab', { name: scenario.nextTab }) ?? screen.getByRole('link', { name: scenario.nextTab }),
      )
      await waitFor(() => expect(window.location.pathname).toBe(scenario.nextPath))
      expect((await screen.findAllByText(scenario.nextText)).length).toBeGreaterThan(0)
    }
  })
})
