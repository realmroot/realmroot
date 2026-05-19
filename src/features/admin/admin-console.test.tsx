import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter, queryClient } from '@/router'
import {
  AccountCenterSettingsPage,
  AdminDashboardPage,
  AdminOnboardingPage,
  ApiResourceDetailPage,
  ApiResourcesPage,
  ApplicationsPage,
  BrandingPage,
  CollectUserProfilePage,
  ConnectorsPage,
  ConsolePlaceholderPage,
  ContentSettingsPage,
  DeploymentSettingsPage,
  MfaPage,
  OrganizationDetailPage,
  OrganizationsPage,
  OrganizationTemplatePage,
  PasswordlessConnectorsPage,
  RoleDetailPage,
  RolesPage,
  SecurityBlocklistPage,
  SecurityCaptchaPage,
  SecurityGeneralPage,
  SecurityPasswordPolicyPage,
  SignInSettingsPage,
  UsersPage,
} from './admin-console'

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('admin console', () => {
  it('renders dashboard metrics and recent operational state', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
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
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminDashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Tenant health' })).toBeTruthy()
    expect(screen.getByText('Total users')).toBeTruthy()
    expect(screen.getByText('New users')).toBeTruthy()
    expect(screen.getByText('Active users')).toBeTruthy()
    expect(screen.getByText('Monthly active')).toBeTruthy()
    expect(screen.getAllByText('Pending')).toHaveLength(3)
    expect(screen.getByText('Setup progress')).toBeTruthy()
    expect(screen.getByText('OIDC endpoints')).toBeTruthy()
    expect(screen.getByText('Health signals')).toBeTruthy()
    expect(screen.getByText('Authorization')).toBeTruthy()
    expect(screen.getByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    expect(screen.getByText('MFA policy')).toBeTruthy()
    expect(screen.getByText('required')).toBeTruthy()
    expect(screen.getByText('Password sign-in')).toBeTruthy()
  })

  it('runs dashboard OIDC actions and renders setup gaps', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    const open = vi.fn()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    vi.spyOn(window, 'open').mockImplementation(open)
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
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
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminDashboardPage />)

    expect(await screen.findByText('Action needed')).toBeTruthy()
    expect(screen.getByText('Required before app sign-in')).toBeTruthy()
    expect(screen.getByText('Password sign-in still works')).toBeTruthy()
    expect(screen.getByText('MFA optional; passkeys disabled')).toBeTruthy()
    expect(screen.getByText('0 users')).toBeTruthy()
    expect(screen.getByText('Create an application to start routing sign-in requests.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Discovery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy issuer' }))

    expect(open).toHaveBeenCalledWith('/api/auth/.well-known/openid-configuration', '_blank', 'noopener')
    expect(clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/api/auth')
  })

  it('renders dashboard load errors with retry action', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ error: { message: 'Management unavailable.' } }, 503))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminDashboardPage />)

    expect(await screen.findByText('Management unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(requests.filter((url) => url === '/api/management/applications').length).toBe(2))
  })

  it('redirects unauthorized Console routes to sign-in with the requested return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings')
        return Promise.resolve(jsonResponse({ error: 'Unauthorized' }, 401))
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(decodeURIComponent(window.location.search)).toContain('return_to=/console/applications')
  })

  it('redirects forbidden Console routes to sign-in with return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse({ error: 'Forbidden' }, 403))
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/users')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(window.location.search).toContain('return_to=')
  })

  it('redirects signed-out account routes to sign-in before rendering account controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ error: 'Authentication is required.' }, 401))
      return Promise.resolve(jsonResponse({}))
    })

    for (const path of [
      '/account',
      '/account/profile',
      '/account/security',
      '/account/linked-accounts',
      '/account/sessions',
      '/account/authorized-apps',
    ]) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
      await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
      expect(new URLSearchParams(window.location.search).get('return_to')).toBe(path)
      expect(screen.queryByRole('navigation', { name: 'Account center' })).toBeNull()

      cleanup()
      queryClient.clear()
    }
  })

  it('surfaces non-auth account guard errors instead of converting them to sign-in redirects', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ error: 'Profile unavailable.' }, 503))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/account/security')

    render(<AppRouter />)

    expect(await screen.findByText('Profile unavailable.')).toBeTruthy()
    expect(window.location.pathname).toBe('/account/security')
  })

  it('redirects fresh deployments from product routes to first-admin onboarding', async () => {
    const requestedUrls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/configz')
        return Promise.resolve(jsonResponse({ ...configz, onboarding: { required: true, href: '/onboarding' } }))
      if (url === '/api/onboarding/status') return Promise.resolve(jsonResponse({ required: true }))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/account/security')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Create the first admin.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/onboarding'))
    expect(requestedUrls).not.toContain('/api/account/profile')
  })

  it('redirects representative fresh deployment product routes to first-admin onboarding', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz')
        return Promise.resolve(jsonResponse({ ...configz, onboarding: { required: true, href: '/onboarding' } }))
      if (url === '/api/onboarding/status') return Promise.resolve(jsonResponse({ required: true }))
      return Promise.resolve(jsonResponse({}))
    })

    for (const path of [
      '/',
      '/sign-in',
      '/sign-up',
      '/account',
      '/account/security',
      '/console',
      '/console/applications',
    ]) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect(await screen.findByRole('heading', { name: 'Create the first admin.' })).toBeTruthy()
      await waitFor(() => expect(window.location.pathname).toBe('/onboarding'))

      cleanup()
      queryClient.clear()
    }
  })

  it('redirects stale first-admin onboarding visits to Console setup', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({
            admin: { setupRequired: true, setupHref: '/console/onboarding', missing: ['oidc_application'] },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/onboarding')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Console setup' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/onboarding'))
  })

  it('renders account root as the profile page', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)
    window.history.pushState(null, '', '/account')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/account'))
  })

  it('renders every account product section from a direct route', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)

    for (const [path, heading] of [
      ['/account/profile', 'Jane Stone'],
      ['/account/security', 'MFA'],
      ['/account/linked-accounts', 'Linked social accounts'],
      ['/account/sessions', 'Sessions and devices'],
      ['/account/authorized-apps', 'Consented applications'],
    ] as const) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect((await screen.findAllByRole('heading', { name: heading })).length).toBeGreaterThan(0)
      expect(window.location.pathname).toBe('/account')

      cleanup()
      queryClient.clear()
    }
  })

  it('redirects protected Console routes to Console setup while setup is incomplete', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({
            admin: { setupRequired: true, setupHref: '/console/onboarding', missing: ['oidc_application'] },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Console setup' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/onboarding'))
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('redirects stale Console setup visits to the Console after setup is complete', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications')
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      if (url.startsWith('/api/management/users')) return Promise.resolve(jsonResponse({ users: [user], pagination }))
      if (url === '/api/management/connectors')
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/onboarding')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Tenant health' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console'))
  })

  it('renders canonical Console routes and default nested redirects', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)

    for (const [path, finalPath, heading] of [
      ['/console', '/console', 'Tenant health'],
      ['/console/applications', '/console/applications', 'Applications'],
      ['/console/sign-in-experience', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
      [
        '/console/sign-in-experience/sign-up-and-sign-in',
        '/console/sign-in-experience/sign-up-and-sign-in',
        'Sign-up and sign-in',
      ],
      ['/console/sign-in-experience/branding', '/console/sign-in-experience/branding', 'Branding'],
      [
        '/console/sign-in-experience/collect-user-profile',
        '/console/sign-in-experience/collect-user-profile',
        'Collect user profile',
      ],
      ['/console/sign-in-experience/account-center', '/console/sign-in-experience/account-center', 'Account Center'],
      ['/console/sign-in-experience/content', '/console/sign-in-experience/content', 'Content'],
      ['/console/security', '/console/security/password-policy', 'Security'],
      ['/console/security/password-policy', '/console/security/password-policy', 'Security'],
      ['/console/security/captcha', '/console/security/captcha', 'CAPTCHA'],
      ['/console/security/blocklist', '/console/security/blocklist', 'Blocklist'],
      ['/console/security/general', '/console/security/general', 'General security'],
      ['/console/mfa', '/console/mfa', 'Multi-factor auth'],
      ['/console/connectors', '/console/connectors/passwordless', 'Passwordless connectors'],
      ['/console/connectors/passwordless', '/console/connectors/passwordless', 'Passwordless connectors'],
      ['/console/connectors/social', '/console/connectors/social', 'Social connectors'],
      ['/console/organization-template', '/console/organization-template/organization-roles', 'Organization roles'],
      [
        '/console/organization-template/organization-roles',
        '/console/organization-template/organization-roles',
        'Organization roles',
      ],
      ['/console/customize-jwt', '/console/customize-jwt', 'Custom JWT'],
      ['/console/webhooks', '/console/webhooks', 'Webhooks'],
      ['/console/audit-logs', '/console/audit-logs', 'Audit logs'],
      ['/console/tenant-settings', '/console/tenant-settings/oidc-configs', 'OIDC configs'],
      ['/console/tenant-settings/oidc-configs', '/console/tenant-settings/oidc-configs', 'OIDC configs'],
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

  it('redirects old admin links to matching Console routes', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)

    for (const [path, finalPath, heading] of [
      ['/admin/sign-in', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
      ['/admin/branding', '/console/sign-in-experience/branding', 'Branding'],
      ['/admin/connectors', '/console/connectors/passwordless', 'Passwordless connectors'],
      ['/admin/security', '/console/security/password-policy', 'Security'],
      ['/admin/deployment', '/console/tenant-settings/oidc-configs', 'OIDC configs'],
      ['/admin/applications/app-1', '/console/applications/app-1', 'Customer portal'],
    ] as const) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect((await screen.findAllByRole('heading', { name: heading })).length).toBeGreaterThan(0)
      await waitFor(() => expect(window.location.pathname).toBe(finalPath))

      cleanup()
      queryClient.clear()
    }
  })

  it('preserves query string and hash when redirecting old admin links', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/admin/users?search=alice#row-1')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeTruthy()
    await waitFor(() =>
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
        '/console/users?search=alice#row-1',
      ),
    )
  })

  it('navigates between Sign-in and account tabs from the shared tab bar', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/sign-in-experience/sign-up-and-sign-in')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign-up and sign-in' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Branding' }))

    expect(await screen.findByRole('heading', { name: 'Branding' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/sign-in-experience/branding'))
  })

  it('renders authorization detail routes with route params', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission] }))
      }
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
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/roles/role-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/roles/role-1')

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/api-resources/resource-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/api-resources/resource-1')

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/organizations/org-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(window.location.pathname).toBe('/console/organizations/org-1')
  })

  it('surfaces non-auth admin readiness errors instead of converting them to sign-in redirects', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse({ error: 'Readiness failed.' }, 500))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications')

    render(<AppRouter />)

    expect(await screen.findByText('Readiness failed.')).toBeTruthy()
    expect(window.location.pathname).toBe('/console/applications')
  })

  it('renders application rows and posts validated create input', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'My apps' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Third-party apps' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Application name' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'App ID' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: 'missing' } })
    expect(await screen.findByText('No applications found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: 'Customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Admin console' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'admin-console' } })
    fireEvent.change(screen.getByLabelText('Client type'), { target: { value: 'confidential_web' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://app.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/applications',
          body: {
            name: 'Admin console',
            slug: 'admin-console',
            clientType: 'confidential_web',
            firstParty: true,
            redirectUris: ['https://app.example.com/callback'],
          },
        },
      ])
    })

    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Third-party apps' }))
    expect(await screen.findByText('No applications in this tab')).toBeTruthy()
  })

  it('closes the application dialog and toggles application availability', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications/app-1' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...application, disabled: true }))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    expect(await screen.findByRole('heading', { name: 'Create application' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create application' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Actions for Customer portal'))
    fireEvent.click(await screen.findByText('Disable'))

    await waitFor(() => {
      expect(requests).toEqual([{ url: '/api/management/applications/app-1', body: { disabled: true } }])
    })
  })

  it('toggles third-party application availability from its tab', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const thirdPartyApplication = { ...application, id: 'app-2', name: 'Partner app', firstParty: false }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications/app-2' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...thirdPartyApplication, disabled: true }))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [thirdPartyApplication], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    fireEvent.click(await screen.findByRole('tab', { name: 'Third-party apps' }))
    expect(await screen.findByText('Partner app')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Partner app'))
    fireEvent.click(await screen.findByText('Disable'))

    await waitFor(() => {
      expect(requests).toEqual([{ url: '/api/management/applications/app-2', body: { disabled: true } }])
    })
  })

  it('shows one-time secret material when creating a confidential application', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          jsonResponse(
            {
              ...application,
              clientId: 'server-client',
              clientType: 'confidential_web',
              public: false,
              requirePkce: false,
              tokenEndpointAuthMethod: 'client_secret_basic',
              clientSecret: 'fas_created_secret',
            },
            201,
          ),
        )
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Server app' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'server-app' } })
    fireEvent.change(screen.getByLabelText('Client type'), { target: { value: 'confidential_web' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://server.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('fas_created_secret')).toBeTruthy()
    expect(requests).toEqual([
      {
        url: '/api/management/applications',
        body: {
          name: 'Server app',
          slug: 'server-app',
          clientType: 'confidential_web',
          firstParty: true,
          redirectUris: ['https://server.example.com/callback'],
        },
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('fas_created_secret')).toBeNull())
  })

  it('shows client-side validation errors and does not post invalid application input', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.includes('/api/management/readiness')) return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Admin console' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'not valid' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://app.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Invalid string: must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('shows pending state while application creation is in flight', async () => {
    let resolveCreate: (response: Response) => void = () => undefined
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve
        })
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Admin console' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'admin-console' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://app.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeTruthy()
    resolveCreate(jsonResponse(application, 201))
  })

  it('renders application detail lifecycle, redirect URI, and integration controls', async () => {
    const requests: Array<{ url: string; body: unknown; method: string }> = []
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    let currentApplication = application
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        requests.push({ url, method, body })
        currentApplication = { ...currentApplication, ...body }
        return Promise.resolve(jsonResponse(currentApplication))
      }
      if (url === '/api/management/applications/app-1/redirect-uris' && method === 'PUT') {
        requests.push({ url, method, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ redirectUris: ['https://new.example.com/callback'] }))
      }
      if (url === '/api/management/applications/app-1/logo' && method === 'POST') {
        requests.push({ url, method, body: init?.body instanceof FormData ? '[form-data]' : init?.body })
        return Promise.resolve(jsonResponse({ asset: uploadedAsset }, 201))
      }
      if (url === '/api/management/applications/app-1' && method === 'DELETE') {
        requests.push({ url, method, body: null })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(currentApplication))
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications/app-1')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Branding' })).toBeTruthy()
    expect(screen.getByLabelText('Application name')).toHaveProperty('value', 'Customer portal')
    expect(screen.getByLabelText('Post sign-out redirect URIs')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('CORS origins')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Custom data JSON')).toHaveProperty('disabled', true)
    expect(screen.getByText('https://auth.example.com/authorize')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/token')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/userinfo')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/jwks')).toBeTruthy()
    expect(screen.getByText('No client secret is issued for public clients.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Application name'), {
      target: { value: 'Customer portal updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { name: 'Customer portal updated', description: null },
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy client config' }))
    expect(JSON.parse(clipboard.writeText.mock.calls[0]?.[0])).toEqual({
      issuer: 'https://auth.example.com',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
      clientId: 'client-1',
      redirectUris: ['https://app.example.com/callback'],
      scopes: 'openid profile',
      tokenEndpointAuthMethod: 'none',
    })

    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://new.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirect URIs' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Branding' }))
    expect(screen.getByText('Display name')).toBeTruthy()
    expect(screen.getByText('Homepage URL')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Upload logo for Customer portal updated'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable application' }))
    expect(await screen.findByRole('button', { name: 'Enable application' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enable application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete application' }).at(-1) as HTMLButtonElement)

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { name: 'Customer portal updated', description: null },
        },
        {
          url: '/api/management/applications/app-1/redirect-uris',
          method: 'PUT',
          body: { redirectUris: ['https://new.example.com/callback'] },
        },
        {
          url: '/api/management/applications/app-1/logo',
          method: 'POST',
          body: '[form-data]',
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { disabled: true, disabledReason: 'Disabled from Console' },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { disabled: false, disabledReason: null },
        },
        { url: '/api/management/applications/app-1', method: 'DELETE', body: null },
      ])
    })
    await waitFor(() => expect(window.location.pathname).toBe('/console/applications'))
  })

  it('shows confidential client secret metadata and one-time rotated secret material', async () => {
    const confidentialApplication = {
      ...application,
      clientType: 'confidential_web',
      public: false,
      requirePkce: false,
      tokenEndpointAuthMethod: 'client_secret_basic',
      secretMetadata: [
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
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url.startsWith('/api/management/applications/app-1/client-secrets') && init?.method === 'POST') {
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
      if (url.startsWith('/api/management/applications/app-1/client-secrets')) {
        return Promise.resolve(jsonResponse({ secrets: confidentialApplication.secretMetadata, pagination }))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(confidentialApplication))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications/app-1')

    render(<AppRouter />)

    expect(await screen.findByText('fas_existing')).toBeTruthy()
    expect(screen.queryByText('fas_rotated_secret')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate client secret' }))

    expect(await screen.findByText('fas_rotated_secret')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('fas_rotated_secret')).toBeNull())
  })

  it('renders application detail mutation errors at the operation boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1/redirect-uris' && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ error: { message: 'Redirect URI is not allowed.' } }, 400))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(application))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications/app-1')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://bad.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirect URIs' }))

    expect(await screen.findByText('Redirect URI is not allowed.')).toBeTruthy()
  })

  it('renders users and displays management API errors from create flow', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Email already exists.' } }, 400))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Created' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Email already exists.')).toBeTruthy()
  })

  it('creates users with optional credentials and toggles admin role', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(user, 201))
      }
      if (url === '/api/management/users/user-1' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...user, role: 'user' }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sam@example.com' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Sam Doe' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sam' } })
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/users',
          body: {
            email: 'sam@example.com',
            displayName: 'Sam Doe',
            username: 'sam',
            password: 'correct horse battery staple',
          },
        },
      ])
    })
    expect(screen.queryByRole('heading', { name: 'Create user' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Actions for jane@example.com'))
    fireEvent.click(await screen.findByText('Toggle admin role'))

    await waitFor(() => {
      expect(requests.at(-1)).toEqual({ url: '/api/management/users/user-1', body: { role: 'user' } })
    })
  })

  it('shows client-side validation errors for user creation', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(user, 201))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-email' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Sam Doe' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid email address')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders fallback mutation errors for non-Error rejections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users' && init?.method === 'POST') {
        return Promise.reject('network failed')
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Request failed.')).toBeTruthy()
  })

  it('sends password reset actions from the users menu', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/users/password-reset-requests') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ accepted: true }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'jane' } })
    expect(await screen.findByLabelText('Actions for jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for jane@example.com'))
    expect(await screen.findByText('Toggle admin role')).toBeTruthy()
    fireEvent.click(await screen.findByText('Send password reset'))

    await waitFor(() => {
      expect(requests).toEqual([
        { url: '/api/management/users/password-reset-requests', body: { email: 'jane@example.com' } },
      ])
    })
  })

  it('applies user list filters and pagination controls', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(
          jsonResponse({
            users: [{ ...user, email: null, emailVerified: true, role: null }],
            pagination: {
              limit: 10,
              offset: url.includes('offset=10') ? 10 : 0,
              total: 30,
              hasMore: true,
              nextOffset: 10,
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('user-1')).toBeTruthy()
    expect(screen.getByText('user')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter role'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Filter status'), { target: { value: 'true' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Previous' }))

    await waitFor(() => {
      expect(
        requests.some((url) => url.includes('role=admin') && url.includes('banned=true') && url.includes('offset=10')),
      ).toBe(true)
    })
    fireEvent.click(screen.getByLabelText('Actions for user-1'))
    expect(screen.queryByText('Send password reset')).toBeNull()
  })

  it('renders user detail data and sends scoped admin actions', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = []
    const fetches: Array<{ method: string; url: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      fetches.push({ method, url })

      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/users/user-1' && method === 'GET') {
        return Promise.resolve(jsonResponse({ user: { ...profile, role: 'admin', banned: false, banReason: null } }))
      }
      if (url === '/api/management/users/user-1' && method === 'PATCH') {
        requests.push({ method, url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(
          jsonResponse({
            user: {
              ...profile,
              role: 'user',
              banned: false,
              banReason: null,
              displayName: 'Jane Q. Stone',
              emailVerified: false,
            },
          }),
        )
      }
      if (url === '/api/management/users/user-1/password-reset-requests' && method === 'POST') {
        requests.push({ method, url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ accepted: true }))
      }
      if (url.startsWith('/api/management/users/user-1/sessions') && method === 'GET') {
        return Promise.resolve(jsonResponse({ sessions: [adminSession], pagination }))
      }
      if (url === '/api/management/users/user-1/sessions/session-1' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(jsonResponse({ success: true }))
      }
      if (url === '/api/management/users/user-1/sessions' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(jsonResponse({ success: true }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [linkedAccount], pagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [userApplication], pagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: adminSecurity }))
      }
      if (url === '/api/management/users/user-1/passkeys/passkey-1' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(jsonResponse({}))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [adminPasskey], pagination }))
      }
      if (url === '/api/management/users/user-1/ban' && method === 'PUT') {
        requests.push({ method, url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(
          jsonResponse({ user: { ...profile, role: 'user', banned: true, banReason: 'abuse', emailVerified: false } }),
        )
      }
      if (url === '/api/management/users/user-1/ban' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(
          jsonResponse({
            user: { ...profile, role: 'user', banned: false, banReason: null, emailVerified: false },
          }),
        )
      }

      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/users/user-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.getByText('MFA and passkeys')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Send password reset' })).toBeTruthy()
    expect(fetches.map((entry) => entry.url)).toEqual(
      expect.arrayContaining([
        '/api/management/users/user-1',
        '/api/management/users/user-1/sessions?',
        '/api/management/users/user-1/linked-accounts?',
        '/api/management/users/user-1/applications?',
        '/api/management/users/user-1/security',
        '/api/management/users/user-1/passkeys?',
      ]),
    )

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Q. Stone' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'user' } })
    fireEvent.change(screen.getByLabelText('Email verification'), { target: { value: 'false' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')!)
    await waitFor(() => expect(requests).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Send password reset' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }))
    await waitFor(() => expect(requests).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sessions' }))
    await waitFor(() => expect(requests).toHaveLength(4))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete passkey' }))
    await waitFor(() => expect(requests).toHaveLength(5))
    fireEvent.click(screen.getAllByRole('button', { name: 'Ban user' })[0]!)
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'abuse' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Ban user' }).at(-1)!)

    await waitFor(() => {
      expect(requests).toEqual([
        {
          method: 'PATCH',
          url: '/api/management/users/user-1',
          body: {
            email: 'jane@example.com',
            displayName: 'Jane Q. Stone',
            username: 'jane',
            role: 'user',
            emailVerified: false,
          },
        },
        {
          method: 'POST',
          url: '/api/management/users/user-1/password-reset-requests',
          body: {},
        },
        {
          method: 'DELETE',
          url: '/api/management/users/user-1/sessions/session-1',
          body: null,
        },
        {
          method: 'DELETE',
          url: '/api/management/users/user-1/sessions',
          body: null,
        },
        {
          method: 'DELETE',
          url: '/api/management/users/user-1/passkeys/passkey-1',
          body: null,
        },
        {
          method: 'PUT',
          url: '/api/management/users/user-1/ban',
          body: { reason: 'abuse' },
        },
      ])
    })
  })

  it('supports unbanning and confirmed deletion from user detail', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/users/user-1' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            user: {
              ...profile,
              role: 'user',
              banned: true,
              banReason: 'abuse',
              banExpires: '2027-01-01T00:00:00.000Z',
            },
          }),
        )
      }
      if (url === '/api/management/users/user-1/ban' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(jsonResponse({ user: { ...profile, role: 'user', banned: false, banReason: null } }))
      }
      if (url === '/api/management/users/user-1' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(jsonResponse({ success: true }))
      }
      if (url.startsWith('/api/management/users/user-1/sessions')) {
        return Promise.resolve(jsonResponse({ sessions: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: adminSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/users/user-1')
    render(<AppRouter />)

    expect(await screen.findByText('abuse')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unban user' }))
    await waitFor(() =>
      expect(requests).toContainEqual({ method: 'DELETE', url: '/api/management/users/user-1/ban', body: null }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete user' }).at(-1)!)

    await waitFor(() =>
      expect(requests).toContainEqual({ method: 'DELETE', url: '/api/management/users/user-1', body: null }),
    )
  })

  it('retries user detail loading and cancels destructive dialogs', async () => {
    const requests: Array<{ method: string; url: string }> = []
    let detailAttempts = 0
    queryClient.setDefaultOptions({ queries: { retry: false } })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ method, url })
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/users/user-1' && method === 'GET') {
        detailAttempts += 1
        if (detailAttempts === 1) return Promise.resolve(jsonResponse({ error: { message: 'User unavailable.' } }, 503))
        return Promise.resolve(jsonResponse({ user: { ...profile, role: 'user', banned: false } }))
      }
      if (url.startsWith('/api/management/users/user-1/sessions')) {
        return Promise.resolve(jsonResponse({ sessions: [adminSession], pagination }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: adminSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [adminPasskey], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/users/user-1')
    render(<AppRouter />)

    expect(await screen.findByText('User unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Ban user' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(requests.filter((request) => request.method !== 'GET')).toEqual([])
  })

  it('renders user detail fallback states and submits no-reason bans', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = []
    queryClient.setDefaultOptions({ queries: { retry: false } })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/users/user-1' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            user: {
              id: 'user-1',
              emailVerified: false,
              username: null,
              role: ['admin', 'support'],
              banned: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        )
      }
      if (url === '/api/management/users/user-1/ban' && method === 'PUT') {
        requests.push({ method, url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ user: { ...profile, role: ['admin', 'support'], banned: true } }))
      }
      if (url.startsWith('/api/management/users/user-1/sessions')) {
        return Promise.resolve(
          jsonResponse({ sessions: [{ ...adminSession, ipAddress: null, userAgent: null }], pagination }),
        )
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(
          jsonResponse({
            security: {
              userId: 'user-1',
              mfa: { enabled: false, factors: [{ id: 'factor-2', type: 'sms', verified: false }] },
              passkeys: { enabled: false, count: 0 },
              policy: { mfa: { mode: 'optional' }, passkeys: { enabled: false, rpName: 'Acme Auth' } },
            },
          }),
        )
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(
          jsonResponse({
            passkeys: [{ ...adminPasskey, name: null, backedUp: false, createdAt: null }],
            pagination,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/users/user-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'user-1' })).toBeTruthy()
    expect(screen.getByText('Multiple roles: admin, support')).toBeTruthy()
    expect(screen.getAllByText('Disabled')).toHaveLength(2)
    expect(screen.getByText('sms')).toBeTruthy()
    expect(screen.getByText('passkey-1')).toBeTruthy()
    expect(screen.getByText(/not backed up/)).toBeTruthy()
    expect(screen.getByText(/Unknown IP/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save profile' }).closest('form')?.noValidate).toBe(true)

    fireEvent.click(screen.getAllByRole('button', { name: 'Ban user' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Ban user' }).at(-1)!)
    await waitFor(() => {
      expect(requests).toEqual([{ method: 'PUT', url: '/api/management/users/user-1/ban', body: {} }])
    })
  })

  it('preserves multi-role users when saving detail profile fields', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/users/user-1' && method === 'GET') {
        return Promise.resolve(jsonResponse({ user: { ...profile, role: ['admin', 'viewer'], banned: false } }))
      }
      if (url === '/api/management/users/user-1' && method === 'PATCH') {
        requests.push({ method, url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ user: { ...profile, role: ['admin', 'viewer'], banned: false } }))
      }
      if (url.startsWith('/api/management/users/user-1/sessions')) {
        return Promise.resolve(jsonResponse({ sessions: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: adminSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/users/user-1')
    render(<AppRouter />)

    expect(await screen.findByLabelText('Role')).toHaveProperty('disabled', true)
    expect(screen.getByText('Multiple roles: admin, viewer')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'roles@example.com' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Roles' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'janeroles' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')!)

    await waitFor(() => {
      expect(requests).toEqual([
        {
          method: 'PATCH',
          url: '/api/management/users/user-1',
          body: {
            email: 'roles@example.com',
            displayName: 'Jane Roles',
            username: 'janeroles',
            emailVerified: true,
          },
        },
      ])
    })
  })

  it('renders connectors, creates a connector, and toggles provider availability', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(connector, 201))
      }
      if (url === '/api/management/connectors/templates') {
        return Promise.resolve(jsonResponse(connectorTemplates))
      }
      if (url === '/api/management/connectors/connector-1') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ ...connector, enabled: false }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Toggle Google'))
    fireEvent.click(screen.getByRole('button', { name: 'Add social connector' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'GitHub' } })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'github' } })
    fireEvent.change(screen.getByLabelText('Provider type'), { target: { value: 'generic_oauth' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } })
    fireEvent.change(screen.getByLabelText('Client secret binding'), { target: { value: 'GITHUB_SECRET' } })
    fireEvent.change(screen.getByLabelText('Issuer'), { target: { value: 'https://github.com/login/oauth' } })
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'read:user user:email' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        { url: '/api/management/connectors/connector-1', body: { enabled: false } },
        {
          url: '/api/management/connectors',
          body: {
            displayName: 'GitHub',
            providerId: 'github',
            providerType: 'generic_oauth',
            clientId: 'client-id',
            clientSecretBinding: 'GITHUB_SECRET',
            issuer: 'https://github.com/login/oauth',
            scopes: ['read:user', 'user:email'],
          },
        },
      ])
    })
  })

  it('shows connector details, saves edits, displays readiness, and deletes connectors', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors/connector-1/readiness') {
        return Promise.resolve(
          jsonResponse({
            connectorId: 'connector-1',
            ready: false,
            checks: [
              {
                key: 'clientSecretAvailable',
                label: 'Secret binding available',
                ok: false,
                message: 'Secret binding is not available in the runtime.',
              },
            ],
          }),
        )
      }
      if (url === '/api/management/connectors/connector-1' && method === 'GET') {
        return Promise.resolve(jsonResponse(connector))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'PATCH') {
        requests.push({ url, method, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ ...connector, displayName: 'Google Workspace' }))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'DELETE') {
        requests.push({ url, method, body: null })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Google'))
    fireEvent.click(await screen.findByText('View details'))
    expect(await screen.findByText('Secret binding available')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Google Workspace' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'google-workspace' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'false' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'workspace-client' } })
    fireEvent.change(screen.getByLabelText('Client secret binding'), { target: { value: 'GOOGLE_WORKSPACE_SECRET' } })
    fireEvent.change(screen.getByLabelText('Issuer'), { target: { value: 'https://workspace.example.com' } })
    fireEvent.change(screen.getByLabelText('Authorization endpoint'), {
      target: { value: 'https://workspace.example.com/authorize' },
    })
    fireEvent.change(screen.getByLabelText('Token endpoint'), {
      target: { value: 'https://workspace.example.com/token' },
    })
    fireEvent.change(screen.getByLabelText('User info endpoint'), {
      target: { value: 'https://workspace.example.com/userinfo' },
    })
    fireEvent.change(screen.getByLabelText('JWKS endpoint'), {
      target: { value: 'https://workspace.example.com/jwks' },
    })
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'openid email profile' } })
    fireEvent.change(screen.getByLabelText('Provider metadata JSON'), { target: { value: '[]' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Provider metadata must be a JSON object.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Provider metadata JSON'), { target: { value: '{"prompt":"consent"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/connectors/connector-1',
        method: 'PATCH',
        body: expect.objectContaining({
          authorizationEndpoint: 'https://workspace.example.com/authorize',
          clientId: 'workspace-client',
          clientSecretBinding: 'GOOGLE_WORKSPACE_SECRET',
          displayName: 'Google Workspace',
          enabled: false,
          issuer: 'https://workspace.example.com',
          jwksEndpoint: 'https://workspace.example.com/jwks',
          providerMetadata: { prompt: 'consent' },
          scopes: ['openid', 'email', 'profile'],
          slug: 'google-workspace',
          tokenEndpoint: 'https://workspace.example.com/token',
          userInfoEndpoint: 'https://workspace.example.com/userinfo',
        }),
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Google'))
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/connectors/connector-1',
        method: 'DELETE',
        body: null,
      })
    })
  })

  it('closes connector delete confirmation without deleting', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors/connector-1' && method === 'DELETE') {
        requests.push({ url, method })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Google'))
    fireEvent.click(await screen.findByText('Delete'))
    expect(screen.getByRole('heading', { name: 'Delete connector' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Delete connector' })).toBeNull()
    })
    expect(requests).toEqual([])
  })

  it('shows connector delete pending and error states', async () => {
    let resolveDelete: (response: Response) => void = () => {}
    const deleteResponse = new Promise<Response>((resolve) => {
      resolveDelete = resolve
    })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors/connector-1' && method === 'DELETE') return deleteResponse
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Google'))
    fireEvent.click(await screen.findByText('Delete'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('button', { name: 'Deleting...' })).toHaveProperty('disabled', true)
    resolveDelete(jsonResponse({ error: { message: 'Delete failed.' } }, 503))

    expect(await screen.findByText('Delete failed.')).toBeTruthy()
  })

  it('covers connector draft creation, metadata validation, and generic OAuth ready details', async () => {
    const genericConnector = {
      ...connector,
      id: 'connector-generic',
      slug: 'generic-oauth',
      providerId: 'generic-oauth',
      providerType: 'generic_oauth',
      displayName: 'Generic OAuth',
      enabled: false,
      clientId: null,
      clientSecretBinding: null,
      issuer: null,
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      scopes: [],
      providerMetadata: {},
    }
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors' && method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse(genericConnector, 201))
      }
      if (url === '/api/management/connectors/connector-generic/readiness') {
        return Promise.resolve(
          jsonResponse({
            connectorId: 'connector-generic',
            ready: true,
            checks: [{ key: 'clientId', label: 'Client ID configured', ok: true, message: 'Client ID is configured.' }],
          }),
        )
      }
      if (url === '/api/management/connectors/connector-generic') return Promise.resolve(jsonResponse(genericConnector))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [genericConnector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Generic OAuth')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add social connector' }))
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'generic-oauth' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'false' } })
    fireEvent.change(screen.getByLabelText('Provider metadata JSON'), { target: { value: '[]' } })
    fireEvent.change(screen.getByLabelText('Authorization endpoint'), {
      target: { value: 'https://idp.example.com/authorize' },
    })
    fireEvent.change(screen.getByLabelText('Token endpoint'), { target: { value: 'https://idp.example.com/token' } })
    fireEvent.change(screen.getByLabelText('User info endpoint'), {
      target: { value: 'https://idp.example.com/userinfo' },
    })
    fireEvent.change(screen.getByLabelText('JWKS endpoint'), { target: { value: 'https://idp.example.com/jwks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Provider metadata must be a JSON object.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Provider metadata JSON'), { target: { value: '{"pkce":true}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/connectors',
        body: expect.objectContaining({
          enabled: false,
          authorizationEndpoint: 'https://idp.example.com/authorize',
          jwksEndpoint: 'https://idp.example.com/jwks',
          providerId: 'generic-oauth',
          providerMetadata: { pkce: true },
          tokenEndpoint: 'https://idp.example.com/token',
          userInfoEndpoint: 'https://idp.example.com/userinfo',
        }),
      })
    })

    fireEvent.click(screen.getByLabelText('Actions for Generic OAuth'))
    fireEvent.click(await screen.findByText('View details'))
    expect(await screen.findByText('Ready')).toBeTruthy()
    expect(screen.getByText(/generic OAuth connector configuration/)).toBeTruthy()
    expect(screen.getByText('Client ID configured')).toBeTruthy()
  })

  it('saves connector detail edits with blank optional fields', async () => {
    const incompleteConnector = {
      ...connector,
      clientId: null,
      clientSecretBinding: null,
      issuer: null,
      scopes: [],
      providerMetadata: {},
    }
    let resolvePatch: (response: Response) => void = () => {}
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve
    })
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors/connector-1/readiness') {
        return Promise.resolve(jsonResponse({ connectorId: 'connector-1', ready: false, checks: [] }))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'GET') {
        return Promise.resolve(jsonResponse(incompleteConnector))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return patchResponse
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [incompleteConnector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Google'))
    fireEvent.click(await screen.findByText('View details'))
    expect(await screen.findByText('Needs attention')).toBeTruthy()
    expect(screen.getByLabelText('Client ID')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Client secret binding')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Issuer')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Scopes')).toHaveProperty('value', '')
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Google Draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('button', { name: 'Saving...' })).toHaveProperty('disabled', true)
    resolvePatch(jsonResponse({ ...incompleteConnector, displayName: 'Google Draft' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/connectors/connector-1',
          body: expect.objectContaining({
            authorizationEndpoint: null,
            clientId: null,
            clientSecretBinding: null,
            displayName: 'Google Draft',
            issuer: null,
            jwksEndpoint: null,
            scopes: [],
            tokenEndpoint: null,
            userInfoEndpoint: null,
          }),
        },
      ])
    })
  })

  it('shows connector detail load errors while configuration is unavailable', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors/connector-1/readiness') {
        return Promise.resolve(jsonResponse({ connectorId: 'connector-1', ready: false, checks: [] }))
      }
      if (url === '/api/management/connectors/connector-1') {
        return Promise.resolve(jsonResponse({ error: { message: 'Connector detail unavailable.' } }, 503))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Google'))
    fireEvent.click(await screen.findByText('View details'))

    expect(await screen.findByRole('heading', { name: 'Connector details' })).toBeTruthy()
    expect(await screen.findByText('Connector detail unavailable.')).toBeTruthy()
  })

  it('shows client-side validation errors for connector creation', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(connector, 201))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add social connector' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'GitHub' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('resets connector template defaults when returning to a custom provider', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add social connector' }))
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'google' } })
    expect(screen.getByLabelText('Provider ID')).toHaveProperty('value', 'google')
    expect(screen.getByLabelText('Scopes')).toHaveProperty('value', 'openid email profile')
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: '' } })

    expect(screen.getByLabelText('Provider type')).toHaveProperty('value', 'social')
    expect(screen.getByLabelText('Provider ID')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Display name')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Scopes')).toHaveProperty('value', '')
  })

  it('renders sign-in settings and security policy surfaces', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByText('Sign-in methods')).toBeTruthy()
    expect(screen.getByLabelText('Default redirect URI')).toHaveProperty('value', 'https://app.example.com/callback')
    expect(screen.getByLabelText('Support email')).toHaveProperty('value', 'support@example.com')
    expect(screen.getByRole('switch', { name: 'Passkey sign-in' })).toHaveProperty('disabled', true)

    unmount()
    renderWithQuery(<MfaPage />)

    expect(await screen.findByText('Factors')).toBeTruthy()
    expect(screen.getByText('Passkeys')).toBeTruthy()
    expect(screen.getByText('Authenticator app')).toBeTruthy()
    expect(screen.getByText('SMS code')).toBeTruthy()
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('value', 'required')
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<SecurityGeneralPage />)
    expect(await screen.findByText('3600s')).toBeTruthy()
  })

  it('renders independent MFA, security, passwordless connector, and OIDC settings surfaces', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse(readinessIncomplete))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<MfaPage />)
    expect(await screen.findByText('Backup codes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)
    expect(screen.getByLabelText('Minimum length')).toHaveProperty('disabled', true)
    expect(screen.getByText('Compromised-password rejection')).toBeTruthy()
    expect(screen.getByText('Required character types')).toBeTruthy()

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)
    expect(screen.getByText('Cloudflare Turnstile')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Setup provider' })).toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)
    expect(screen.getByText('Block email subaddressing')).toBeTruthy()
    expect(screen.getByLabelText('Custom email and domain blocklist')).toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<PasswordlessConnectorsPage />)
    expect(
      await screen.findByText('Email delivery is limited to the configured runtime email service binding.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Setup SMS' })).toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)
    expect(await screen.findByText('Signing keys')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rotate key' })).toHaveProperty('disabled', true)
  })

  it('retries new security, connector, and OIDC surface load errors', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(jsonResponse({ error: 'Sign-in settings unavailable.' }, 503))
      }
      if (url === '/api/management/security/policy') {
        return Promise.resolve(jsonResponse({ error: 'Security policy unavailable.' }, 503))
      }
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse(readinessIncomplete))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<PasswordlessConnectorsPage />)

    expect(await screen.findByText('Sign-in settings unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/sign-in-settings').length).toBe(2))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/readiness').length).toBe(2))

    unmount()
    renderWithQuery(<SecurityGeneralPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/security/policy').length).toBe(2))

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/security/policy').length).toBe(4))
  })

  it('saves sign-in settings through the management boundary', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Password sign-in' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Registration' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social sign-in' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Identifier-first flow' }))
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Sign in to Northstar' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Continue to Northstar.' } })
    fireEvent.change(screen.getByLabelText('Default application ID'), { target: { value: 'app-northstar' } })
    fireEvent.change(screen.getByLabelText('Default redirect URI'), {
      target: { value: 'https://northstar.example.com/callback' },
    })
    fireEvent.change(screen.getByLabelText('Privacy URL'), {
      target: { value: 'https://northstar.example.com/privacy' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'support@northstar.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in settings' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/sign-in-settings',
          body: {
            signIn: {
              passwordEnabled: false,
              signupEnabled: false,
              socialLoginEnabled: false,
              identifierFirst: true,
            },
            defaults: {
              applicationId: 'app-northstar',
              redirectUri: 'https://northstar.example.com/callback',
            },
            links: {
              termsUri: 'https://example.com/terms',
              privacyUri: 'https://northstar.example.com/privacy',
              supportEmail: 'support@northstar.example',
            },
            copy: {
              productName: 'Northstar ID',
              headline: 'Sign in to Northstar',
              description: 'Continue to Northstar.',
            },
          },
        },
      ]),
    )
  })

  it('renders sign-in validation errors without sending invalid public URLs', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.change(await screen.findByLabelText('Terms URL'), { target: { value: 'http://example.com/terms' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in settings' }))

    expect(await screen.findByText('URL must use https.')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders sign-in save errors from the management boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Sign-in save failed.' } }, 500))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Save sign-in settings' }))

    expect(await screen.findByText('Sign-in save failed.')).toBeTruthy()
  })

  it('renders unavailable sign-in method states from runtime config', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            signIn: {
              ...signInSettings.signIn,
              passwordEnabled: false,
              magicLinkEnabled: false,
              emailOtpEnabled: true,
              usernameEnabled: false,
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByText('Sign-in methods')).toBeTruthy()
    expect(screen.getByText('Sign-up password requirement').nextSibling?.textContent).toBe('Unavailable')
    expect(screen.getAllByText('Email').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Magic link').nextSibling?.textContent).toBe('Unavailable')
    expect(screen.getByText('Email OTP').nextSibling?.textContent).toBe('Available from runtime')
    expect(screen.getByText('Forgot-password verification').nextSibling?.textContent).toBe('Email OTP available')
  })

  it('saves branding settings and applies custom CSS to the preview', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/northstar-logo.svg' },
    })
    expect(document.querySelector('img.brandLogo')?.getAttribute('width')).toBe('36')
    expect(document.querySelector('img.brandLogo')?.getAttribute('height')).toBe('36')
    expect(document.querySelector('img.assetPreview')?.getAttribute('width')).toBe('64')
    expect(document.querySelector('img.assetPreview')?.getAttribute('height')).toBe('64')
    fireEvent.change(screen.getByLabelText('Favicon URL'), {
      target: { value: 'https://cdn.example.com/northstar.ico' },
    })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#0f766e' } })
    fireEvent.change(screen.getByLabelText('Background color'), { target: { value: '#f8fafc' } })
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: '--auth-panel-radius: 16px;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))

    expect(screen.getByText('Live preview').closest('.brandingPreview')?.getAttribute('style')).toContain(
      '--auth-panel-radius: 16px',
    )
    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/branding-settings',
          body: {
            branding: {
              logoUrl: 'https://cdn.example.com/northstar-logo.svg',
              faviconUrl: 'https://cdn.example.com/northstar.ico',
              primaryColor: '#0f766e',
              backgroundColor: '#f8fafc',
              customCss: '--auth-panel-radius: 16px;',
            },
            copy: {
              productName: 'Northstar ID',
              headline: 'Sign in to Acme Auth',
              description: 'Continue with your Acme identity.',
            },
          },
        },
      ]),
    )
  })

  it('switches the hosted sign-in preview between desktop and mobile viewports', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    const preview = (await screen.findByText('Live preview')).closest('.brandingPreview')
    expect(preview?.className).not.toContain('max-w-80')

    fireEvent.click(screen.getByRole('tab', { name: 'Mobile' }))

    expect(screen.getByRole('tab', { name: 'Mobile' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Live preview').closest('.brandingPreview')?.className).toContain('max-w-80')
  })

  it('does not apply unsafe custom CSS to the branding preview', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Custom CSS'), { target: { value: 'display: none;' } })

    expect(screen.getByText('Live preview').closest('.brandingPreview')?.getAttribute('style')).not.toContain('display')
  })

  it('renders branding validation errors without sending invalid custom CSS', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Custom CSS'), { target: { value: 'display: none;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))

    expect(
      await screen.findByText('Custom CSS only supports declaration-only --auth-* custom properties.'),
    ).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders branding save and upload errors from the management boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Branding save failed.' } }, 500))
      }
      if (url === '/api/management/branding/logo' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Logo upload failed.' } }, 500))
      }
      if (url === '/api/management/branding/favicon' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Favicon upload failed.' } }, 500))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<BrandingPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Save branding' }))
    expect(await screen.findByText('Branding save failed.')).toBeTruthy()

    unmount()
    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Upload branding logo'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Logo upload failed.')).toBeTruthy()

    cleanup()
    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Upload favicon'), {
      target: { files: [new File(['icon'], 'favicon.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Favicon upload failed.')).toBeTruthy()
  })

  it('uses default branding form values when optional branding settings are absent', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') {
        return Promise.resolve(
          jsonResponse({
            branding: {
              logoUrl: null,
              faviconUrl: null,
              primaryColor: null,
              backgroundColor: null,
              customCss: null,
            },
            copy: brandingSettings.copy,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    expect(await screen.findByDisplayValue('Acme Auth')).toBeTruthy()
    expect(screen.getByLabelText('Logo URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Primary color')).toHaveProperty('value', '#b42318')
    expect(screen.getByLabelText('Background color')).toHaveProperty('value', '#f7f3ee')
    expect(screen.getByLabelText('Custom CSS')).toHaveProperty('value', '')
  })

  it('renders sign-in and account configuration tabs with unsupported settings disabled', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<CollectUserProfilePage />)

    expect(screen.getByRole('tab', { name: 'Collect user profile' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('button', { name: 'Add field' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/Field label, field type, and user data key controls/)).toBeTruthy()

    unmount()
    renderWithQuery(<AccountCenterSettingsPage />)

    expect(screen.getByRole('tab', { name: 'Account Center' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('/api/account')).toBeTruthy()
    expect(screen.getByText('Authorized apps view')).toBeTruthy()

    cleanup()
    renderWithQuery(<ContentSettingsPage />)

    expect((await screen.findByRole('tab', { name: 'Content' })).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByLabelText('Language')).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Sign-in message')).toHaveProperty('value', 'Sign in to Acme Auth')
  })

  it('opens account center from the account configuration tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderWithQuery(<AccountCenterSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Open account center' }))

    expect(open).toHaveBeenCalledWith('/account', '_blank', 'noopener')
  })

  it('saves content settings through the sign-in management boundary', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ContentSettingsPage />)

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Sign-in message'), { target: { value: 'Welcome to Northstar' } })
    fireEvent.change(screen.getByLabelText('Sign-up message'), { target: { value: 'Create your Northstar identity.' } })
    fireEvent.change(screen.getByLabelText('Terms URL'), { target: { value: 'https://northstar.example.com/terms' } })
    fireEvent.change(screen.getByLabelText('Privacy URL'), {
      target: { value: 'https://northstar.example.com/privacy' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'support@northstar.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save content' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/sign-in-settings',
          body: {
            links: {
              termsUri: 'https://northstar.example.com/terms',
              privacyUri: 'https://northstar.example.com/privacy',
              supportEmail: 'support@northstar.example',
            },
            copy: {
              productName: 'Northstar ID',
              headline: 'Welcome to Northstar',
              description: 'Create your Northstar identity.',
            },
          },
        },
      ]),
    )
  })

  it('renders content validation errors without sending invalid links', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ContentSettingsPage />)

    fireEvent.change(await screen.findByLabelText('Privacy URL'), { target: { value: 'http://example.com/privacy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save content' }))

    expect(await screen.findByText('URL must use https.')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders content save errors from the management boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Content save failed.' } }, 500))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ContentSettingsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Save content' }))

    expect(await screen.findByText('Content save failed.')).toBeTruthy()
  })

  it('uses empty content link defaults when optional links are absent', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            links: { termsUri: null, privacyUri: null, supportEmail: null },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ContentSettingsPage />)

    expect(await screen.findByLabelText('Terms URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Privacy URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Support email')).toHaveProperty('value', '')
  })

  it('creates organizations, roles, and API resources from admin dialogs', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/organizations' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(organization, 201))
      }
      if (url === '/api/management/roles' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(role, 201))
      }
      if (url === '/api/management/api-resources' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(apiResource, 201))
      }
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<OrganizationsPage />)

    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Organization' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Display name' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Logo' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New organization' }))
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'northwind' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Northwind' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Northwind Traders' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(1))

    unmount()
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('Admin')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Scope' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'System' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auditor' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reads audit events' } })
    fireEvent.change(screen.getByLabelText('API resource'), { target: { value: 'resource-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(2))

    unmount()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Management API')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Resource' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Audience' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New resource' }))
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'billing-api' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Billing API' } })
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'https://billing.example.com' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Billing resource' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/organizations',
          body: { slug: 'northwind', name: 'Northwind', displayName: 'Northwind Traders' },
        },
        {
          url: '/api/management/roles',
          body: { key: 'auditor', name: 'Auditor', description: 'Reads audit events', resourceId: 'resource-1' },
        },
        {
          url: '/api/management/api-resources',
          body: {
            identifier: 'billing-api',
            name: 'Billing API',
            audience: 'https://billing.example.com',
            description: 'Billing resource',
          },
        },
      ])
    })
  })

  it('renders and updates organization detail records', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/organizations/org-1' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...organization, ...JSON.parse(String(init.body)) }))
      }
      if (url === '/api/management/organizations/org-1') return Promise.resolve(jsonResponse(organization))
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(screen.getByText('Organization ID')).toBeTruthy()
    expect(screen.getByText('Members and invitations')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Acme Updated' } })
    fireEvent.change(screen.getByLabelText('Disabled reason'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save organization' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/organizations/org-1',
        body: {
          slug: 'acme',
          name: 'Acme',
          displayName: 'Acme Updated',
          disabledReason: null,
        },
      })
    })
  })

  it('searches organization template roles and opens permission guidance', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/roles') {
        return Promise.resolve(
          jsonResponse({
            roles: [
              {
                ...role,
                id: 'role-billing',
                key: 'billing-manager',
                name: 'Billing manager',
                description: 'Controls invoices',
                organizationId: 'org-1',
                tokenClaimName: 'billing_roles',
              },
              {
                ...role,
                id: 'role-member',
                key: 'member',
                name: 'Member',
                description: 'Default organization membership',
              },
            ],
            pagination,
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<OrganizationTemplatePage />)

    expect(await screen.findByRole('heading', { name: 'Organization roles' })).toBeTruthy()
    expect(screen.getByText('Billing manager')).toBeTruthy()
    expect(screen.getByText('Member')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search organization roles'), { target: { value: 'billing' } })
    expect(screen.getByText('Billing manager')).toBeTruthy()
    expect(screen.queryByText('Member')).toBeNull()
    expect(screen.getByText('Organization')).toBeTruthy()
    expect(screen.getByText('billing_roles')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Organization permissions' }))
    expect(screen.getByText('Permission templates use API resources')).toBeTruthy()
  })

  it('renders console placeholder rows', () => {
    render(
      <ConsolePlaceholderPage
        title="Placeholder module"
        description="Placeholder description"
        rows={[
          ['Support', 'Unavailable in this plan'],
          ['Status', 'Configuration only'],
        ]}
      />,
    )

    expect(screen.getAllByRole('heading', { name: 'Placeholder module' })).toHaveLength(2)
    expect(screen.getByText('Support')).toBeTruthy()
    expect(screen.getByText('Unavailable in this plan')).toBeTruthy()
    expect(screen.getByText('Status')).toBeTruthy()
    expect(screen.getByText('Configuration only')).toBeTruthy()
  })

  it('shows client-side validation errors for simple create dialogs', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/roles' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(role, 201))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(apiResource, 201))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<RolesPage />)

    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])

    unmount()
    renderWithQuery(<ApiResourcesPage />)

    expect(await screen.findByText('Management API')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New resource' }))
    fireEvent.change(screen.getByLabelText('Identifier'), { target: { value: 'billing-api' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('manages API resource scopes, permissions, role permissions, and assignments from detail pages', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/management/api-resources/resource-1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...apiResource, ...JSON.parse(String(init?.body)) }))
      }
      if (url === '/api/management/api-resources/resource-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        if (method === 'POST') return Promise.resolve(jsonResponse(apiScope, 201))
        return Promise.resolve(jsonResponse({ scopes: [apiScope], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/scopes/scope-1')
        return Promise.resolve(jsonResponse(apiScope))
      if (url === '/api/management/api-resources/resource-1/permissions') {
        if (method === 'POST') return Promise.resolve(jsonResponse(apiPermission, 201))
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions/permission-1') {
        return Promise.resolve(jsonResponse(apiPermission))
      }
      if (url === '/api/management/roles/role-1')
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      if (url === '/api/management/roles/role-1/permissions') {
        if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/user-role-assignments') return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/management/application-role-assignments')
        return Promise.resolve(new Response(null, { status: 204 }))
      if (url === '/api/management/member-role-assignments') return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'PATCH',
        body: { enabled: false },
      }),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'orders:write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create scope' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes',
        method: 'POST',
        body: { value: 'orders:write' },
      }),
    )
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'orders.write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create permission' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions',
        method: 'POST',
        body: { key: 'orders.write' },
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes/scope-1',
        method: 'PATCH',
        body: { value: 'orders:read', description: 'Read orders' },
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes/scope-1',
        method: 'DELETE',
        body: null,
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' }).at(-1)!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions/permission-1',
        method: 'PATCH',
        body: {
          key: 'orders.read',
          description: 'Read orders',
          scopeId: 'scope-1',
          tokenClaimValue: 'read',
        },
      }),
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions/permission-1',
        method: 'DELETE',
        body: null,
      }),
    )

    unmount()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('orders.read')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1/permissions',
        method: 'PUT',
        body: { permissionIds: ['permission-1'] },
      }),
    )
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'user-1' } })
    fireEvent.change(screen.getByLabelText('Token claims JSON'), { target: { value: 'not-json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    expect(await screen.findByText(/Unexpected token/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Token claims JSON'), { target: { value: '{"tier":"gold"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/user-role-assignments',
        method: 'POST',
        body: { roleId: 'role-1', subjectId: 'user-1', tokenClaims: { tier: 'gold' } },
      }),
    )
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'application' } })
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'app-1' } })
    fireEvent.change(screen.getByLabelText('Token claims JSON'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/application-role-assignments',
        method: 'POST',
        body: { roleId: 'role-1', subjectId: 'app-1' },
      }),
    )
    fireEvent.change(screen.getByLabelText('Subject type'), { target: { value: 'member' } })
    fireEvent.change(screen.getByLabelText('Subject ID'), { target: { value: 'member-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/member-role-assignments',
        method: 'POST',
        body: { roleId: 'role-1', subjectId: 'member-1' },
      }),
    )
  })

  it('updates and deletes authorization roles and resources', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/management/api-resources/resource-1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...apiResource, ...JSON.parse(String(init?.body)) }))
      }
      if (url === '/api/management/api-resources/resource-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/roles/role-1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...role, system: false, ...JSON.parse(String(init?.body)) }))
      }
      if (url === '/api/management/roles/role-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, system: false, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Orders API' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'PATCH',
        body: {
          identifier: 'management-api',
          name: 'Orders API',
          description: 'Management surface',
          audience: 'https://auth.example.com/api/management',
          tokenClaimsNamespace: null,
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete resource' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'DELETE',
        body: null,
      }),
    )

    unmount()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Operator' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1',
        method: 'PATCH',
        body: { key: 'admin', name: 'Operator', description: 'Tenant administrator' },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1',
        method: 'DELETE',
        body: null,
      }),
    )
  })

  it('redirects after deleting authorization details from routed pages', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method })
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/roles/role-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, system: false, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources/resource-1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/console/roles/role-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete role' }))
    await waitFor(() => expect(window.location.pathname).toBe('/console/roles'))
    expect(requests).toContainEqual({ url: '/api/management/roles/role-1', method: 'DELETE' })

    cleanup()
    queryClient.clear()
    window.history.pushState(null, '', '/console/api-resources/resource-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete resource' }))
    await waitFor(() => expect(window.location.pathname).toBe('/console/api-resources'))
    expect(requests).toContainEqual({ url: '/api/management/api-resources/resource-1', method: 'DELETE' })
  })

  it('renders empty authorization detail rows and inline validation errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByText('No scopes yet.')).toBeTruthy()
    expect(screen.getByText('No permissions yet.')).toBeTruthy()

    fireEvent.submit(screen.getByRole('button', { name: 'Create scope' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
  })

  it('retries authorization detail loading failures', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ error: 'Role unavailable.' }, 503))
      }
      if (url === '/api/management/api-resources/resource-1') {
        return Promise.resolve(jsonResponse({ error: 'Resource unavailable.' }, 503))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url.endsWith('/scopes')) return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      if (url.endsWith('/permissions')) {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByText('Role unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/roles/role-1').length).toBe(2))

    unmount()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByText('Resource unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/api-resources/resource-1').length).toBe(2),
    )
  })

  it('loads role permissions after selecting an API resource on a global role', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/roles/role-1') return Promise.resolve(jsonResponse(role))
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('API resource'), { target: { value: 'resource-1' } })

    expect(await screen.findByText('orders.read')).toBeTruthy()
  })

  it('refetches role permissions after saving permission assignments', async () => {
    const requests: Array<{ url: string; method: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ url, method })
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') {
        if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
        return Promise.resolve(jsonResponse({ permissions: [] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByText('orders.read')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() =>
      expect(requests.filter((request) => request.url === '/api/management/roles/role-1/permissions')).toEqual([
        { url: '/api/management/roles/role-1/permissions', method: 'GET' },
        { url: '/api/management/roles/role-1/permissions', method: 'PUT' },
        { url: '/api/management/roles/role-1/permissions', method: 'GET' },
      ]),
    )
  })

  it('removes a selected role permission from local assignment state', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET') requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url === '/api/management/roles/role-1')
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      if (url === '/api/management/roles/role-1/permissions') {
        if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }))
        return Promise.resolve(jsonResponse({ permissions: [apiPermission] }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('checkbox')).toHaveProperty('checked', true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1/permissions',
        method: 'PUT',
        body: { permissionIds: [] },
      }),
    )
  })

  it('renders admin variants for empty, disabled, and unset states', async () => {
    const disabledApplication = { ...application, disabled: true, trusted: false }
    const idOnlyUser = { ...user, email: null, name: null, role: ['admin', 'viewer'] }
    const defaultConnector = { ...connector, enabled: false, scopes: [] }
    const unsetSignInSettings = {
      ...signInSettings,
      signIn: { ...signInSettings.signIn, passwordEnabled: false },
      defaults: { applicationId: null, redirectUri: null },
      links: { termsUri: null, privacyUri: null, supportEmail: null },
    }
    const passkeysDisabled = {
      policy: {
        ...securityPolicy.policy,
        passkeys: { ...securityPolicy.policy.passkeys, enabled: false },
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [disabledApplication], pagination }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [idOnlyUser], pagination }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [defaultConnector], pagination }))
      }
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [{ ...organization, displayName: null }], pagination }))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(unsetSignInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(passkeysDisabled))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminDashboardPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('Password sign-in')).toBeTruthy()
    expect(screen.getAllByText('Disabled').length).toBeGreaterThan(0)

    cleanup()
    renderWithQuery(<ApplicationsPage />)
    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for Customer portal'))
    expect(await screen.findByText('Enable')).toBeTruthy()

    cleanup()
    renderWithQuery(<UsersPage />)
    expect(await screen.findAllByText('user-1')).toHaveLength(2)
    expect(screen.getByText('admin, viewer')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Actions for user-1'))
    expect(await screen.findByText('Toggle admin role')).toBeTruthy()
    expect(screen.queryByText('Send password reset')).toBeNull()

    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByText('Default')).toBeTruthy()

    cleanup()
    renderWithQuery(<SignInSettingsPage />)
    expect(await screen.findByLabelText('Product name')).toHaveProperty('value', 'Acme Auth')

    cleanup()
    renderWithQuery(<MfaPage />)
    expect(await screen.findByText('Passkeys')).toBeTruthy()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText('Not set')).toBeTruthy()
  })

  it('renders explicit empty states for admin collection pages', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
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
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<ApplicationsPage />)
    expect(await screen.findByText('No applications yet')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    expect(await screen.findByRole('heading', { name: 'Create application' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create application' })).toBeNull()

    unmount()
    renderWithQuery(<UsersPage />)
    expect(await screen.findByText('No users yet')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    expect(await screen.findByRole('heading', { name: 'Create user' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create user' })).toBeNull()

    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByText('No social connectors yet')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add social connector' }))
    expect(await screen.findByRole('heading', { name: 'Create connector' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create connector' })).toBeNull()

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText('No organizations yet')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New organization' }))
    expect(await screen.findByRole('heading', { name: 'Create organization' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create organization' })).toBeNull()

    cleanup()
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('No roles yet')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    expect(await screen.findByRole('heading', { name: 'Create role' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create role' })).toBeNull()

    cleanup()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('No API resources yet')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New resource' }))
    expect(await screen.findByRole('heading', { name: 'Create API resource' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create API resource' })).toBeNull()
  })

  it('renders collection loading and query error states', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return new Promise(() => undefined)
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<ApplicationsPage />)
    expect(await screen.findByText('Loading applications')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    unmount()
    vi.restoreAllMocks()
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ error: { message: 'Users unavailable.' } }, 503))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UsersPage />)
    expect(await screen.findByText('Users unavailable.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('retries admin resource page errors', async () => {
    for (const scenario of [
      {
        component: <ApplicationsPage />,
        matches: (url: string) => url === '/api/management/applications',
        success: { applications: [application], pagination },
        text: 'Customer portal',
      },
      {
        component: <ConnectorsPage />,
        matches: (url: string) => url === '/api/management/connectors',
        success: { connectors: [connector], pagination },
        text: 'Google',
      },
      {
        component: <AdminOnboardingPage />,
        matches: (url: string) => url === '/api/management/readiness',
        success: readinessIncomplete,
        text: 'Setup checklist',
      },
      {
        component: <SignInSettingsPage />,
        matches: (url: string) => url === '/api/management/sign-in-settings',
        success: signInSettings,
        text: 'Sign-in methods',
      },
      {
        component: <ContentSettingsPage />,
        matches: (url: string) => url === '/api/management/sign-in-settings',
        success: signInSettings,
        text: 'Language and messages',
      },
      {
        component: <BrandingPage />,
        matches: (url: string) => url === '/api/management/branding-settings',
        success: brandingSettings,
        text: 'Hosted sign-in preview',
      },
      {
        component: <MfaPage />,
        matches: (url: string) => url === '/api/management/security/policy',
        success: securityPolicy,
        text: 'Factors',
      },
      {
        component: <OrganizationsPage />,
        matches: (url: string) => url === '/api/management/organizations',
        success: { organizations: [organization], pagination },
        text: 'Acme',
      },
      {
        component: <RolesPage />,
        matches: (url: string) => url === '/api/management/roles',
        success: { roles: [role], pagination },
        text: 'Admin',
      },
      {
        component: <ApiResourcesPage />,
        matches: (url: string) => url === '/api/management/api-resources',
        success: { resources: [apiResource], pagination },
        text: 'Management API',
      },
    ]) {
      let attempts = 0
      vi.spyOn(window, 'fetch').mockImplementation((input) => {
        const url = String(input)
        if (scenario.matches(url)) {
          attempts += 1
          return attempts === 1
            ? Promise.resolve(jsonResponse({ error: { message: 'Temporary unavailable.' } }, 503))
            : Promise.resolve(jsonResponse(scenario.success))
        }
        return Promise.resolve(jsonResponse({}))
      })

      renderWithQuery(scenario.component)

      expect(await screen.findByText('Temporary unavailable.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(await screen.findByText(scenario.text)).toBeTruthy()

      cleanup()
      vi.restoreAllMocks()
    }
  })

  it('renders editable branding and tenant settings pages', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })
    const { unmount } = renderWithQuery(<BrandingPage />)

    expect(screen.getByRole('heading', { name: 'Branding' })).toBeTruthy()
    expect(await screen.findByDisplayValue('Acme Auth')).toBeTruthy()
    expect(screen.getByText('Hosted sign-in preview')).toBeTruthy()

    unmount()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(screen.getByRole('heading', { name: 'OIDC configs' })).toBeTruthy()
    expect(await screen.findByText('Cloudflare Workers')).toBeTruthy()
    expect(screen.getByText('/api/management')).toBeTruthy()
  })

  it('uploads application, organization, branding, and favicon assets', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/onboarding/status') return Promise.resolve(jsonResponse({ required: false }))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (init?.method === 'POST') {
        requests.push({
          url,
          method: init.method,
          body: init.body instanceof FormData ? '[form-data]' : init.body,
        })
        return Promise.resolve(jsonResponse({ asset: uploadedAsset }, 201))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)
    fireEvent.change(await screen.findByLabelText('Upload logo for Customer portal'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1/logo',
        method: 'POST',
        body: '[form-data]',
      })
    })

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    fireEvent.change(await screen.findByLabelText('Upload logo for Acme'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })

    cleanup()
    renderWithQuery(<BrandingPage />)
    fireEvent.change(await screen.findByLabelText('Upload branding logo'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    fireEvent.change(screen.getByLabelText('Upload favicon'), {
      target: { files: [new File(['icon'], 'favicon.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          { url: '/api/management/organizations/org-1/logo', method: 'POST', body: '[form-data]' },
          { url: '/api/management/branding/logo', method: 'POST', body: '[form-data]' },
          { url: '/api/management/branding/favicon', method: 'POST', body: '[form-data]' },
        ]),
      )
    })
  })

  it('creates the first OIDC client from admin onboarding and copies integration details', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.includes('/api/management/readiness')) return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminOnboardingPage />)

    expect(await screen.findByText('Setup checklist')).toBeTruthy()
    expect(screen.getByText('Create an OIDC application')).toBeTruthy()
    expect(screen.getByText('Confirm email delivery')).toBeTruthy()
    expect(screen.getByDisplayValue('Customer portal')).toBeTruthy()
    expect(screen.getByDisplayValue('customer-portal')).toBeTruthy()
    expect(screen.getByLabelText('Application name')).toHaveProperty('value', 'Customer portal')
    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'customer-portal')
    fireEvent.change(await screen.findByLabelText('Application name'), { target: { value: 'Review app' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'review-app' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'http://localhost:4173/oidc/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create OIDC client' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/applications',
          body: {
            name: 'Review app',
            slug: 'review-app',
            clientType: 'public_spa',
            firstParty: true,
            redirectUris: ['http://localhost:4173/oidc/callback'],
          },
        },
      ])
    })
    expect(await screen.findByText('client-1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled())
    expect(JSON.parse(clipboard.writeText.mock.calls[0]?.[0])).toEqual({
      issuer: 'http://localhost:3000/api/auth',
      discoveryUrl: 'http://localhost:3000/api/auth/.well-known/openid-configuration',
      clientId: 'client-1',
      redirectUri: 'http://localhost:4173/oidc/callback',
      scopes: 'openid profile email',
    })
  })
})

function renderWithQuery(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function accountRouteFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile }))
  if (url === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
  if (url === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
  if (url === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
  if (url === '/api/account/security') return Promise.resolve(jsonResponse({ security: accountSecurity }))
  if (url === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
  return Promise.resolve(jsonResponse(init?.method ? { ok: true } : {}))
}

function consoleRouteFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/management/readiness') {
    return Promise.resolve(
      jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
    )
  }
  if (url === '/api/management/applications') {
    return Promise.resolve(jsonResponse({ applications: [application], pagination }))
  }
  if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(application))
  if (url.startsWith('/api/management/users')) return Promise.resolve(jsonResponse({ users: [user], pagination }))
  if (url === '/api/management/connectors') {
    return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
  }
  if (url === '/api/management/connectors/templates') {
    return Promise.resolve(jsonResponse(connectorTemplates))
  }
  if (url === '/api/management/organizations') {
    return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
  }
  if (url === '/api/management/organizations/org-1') return Promise.resolve(jsonResponse(organization))
  if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
  if (url === '/api/management/api-resources') {
    return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
  }
  if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
  if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
  return Promise.resolve(jsonResponse({}))
}

const pagination = {
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
  nextOffset: null,
}

const emptyPagination = {
  ...pagination,
  total: 0,
}

const application = {
  id: 'app-1',
  slug: 'customer-portal',
  name: 'Customer portal',
  description: null,
  homepageUrl: null,
  iconUrl: null,
  clientId: 'client-1',
  clientType: 'public_spa',
  public: true,
  firstParty: true,
  trusted: true,
  disabled: false,
  disabledReason: null,
  redirectUris: ['https://app.example.com/callback'],
  allowedGrantTypes: ['authorization_code'],
  allowedScopes: ['openid', 'profile'],
  requirePkce: true,
  tokenEndpointAuthMethod: 'none',
  secretMetadata: [],
  oidc: {
    issuer: 'https://auth.example.com',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    jwksUri: 'https://auth.example.com/jwks',
    userInfoEndpoint: 'https://auth.example.com/userinfo',
    endSessionEndpoint: 'https://auth.example.com/logout',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const user = {
  id: 'user-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  role: 'admin',
  banned: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const profile = {
  id: 'user-1',
  email: 'jane@example.com',
  emailVerified: true,
  displayName: 'Jane Stone',
  username: 'jane',
  avatarAssetId: null,
  image: null,
}

const connector = {
  id: 'connector-1',
  providerId: 'google',
  providerType: 'social',
  slug: 'google',
  displayName: 'Google',
  enabled: true,
  clientId: 'google-client',
  clientSecretBinding: 'GOOGLE_CLIENT_SECRET',
  issuer: 'https://accounts.google.com',
  authorizationEndpoint: null,
  tokenEndpoint: null,
  userInfoEndpoint: null,
  jwksEndpoint: null,
  scopes: ['openid', 'email'],
  providerMetadata: { prompt: 'select_account' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const connectorTemplates = {
  templates: [
    {
      providerType: 'social',
      providerId: 'google',
      displayName: 'Google',
      icon: 'google',
      requiredFields: ['clientId', 'clientSecretBinding'],
      optionalFields: ['scopes'],
      defaultScopes: ['openid', 'email', 'profile'],
      endpoints: {
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
      },
    },
    {
      providerType: 'generic_oauth',
      providerId: 'generic-oauth',
      displayName: 'Generic OAuth',
      icon: 'oauth',
      requiredFields: ['clientId', 'clientSecretBinding', 'issuer or authorizationEndpoint + tokenEndpoint'],
      optionalFields: ['scopes'],
      defaultScopes: ['openid', 'email', 'profile'],
      endpoints: {
        issuer: null,
        authorizationEndpoint: null,
        tokenEndpoint: null,
        userInfoEndpoint: null,
        jwksEndpoint: null,
      },
    },
  ],
}

const organization = {
  id: 'org-1',
  slug: 'acme',
  name: 'Acme',
  displayName: 'Acme Inc.',
  logo: null,
  metadata: null,
  disabled: false,
  disabledReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const uploadedAsset = {
  id: 'asset-1',
  purpose: 'application_logo',
  publicUrl: 'https://auth.example.com/api/assets/asset-1',
  contentType: 'image/png',
  byteSize: 6,
  checksumSha256: 'checksum-1',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const role = {
  id: 'role-1',
  key: 'admin',
  name: 'Admin',
  description: 'Tenant administrator',
  system: true,
  applicationId: null,
  organizationId: null,
  resourceId: null,
  tokenClaimName: null,
  tokenClaimValue: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const apiResource = {
  id: 'resource-1',
  identifier: 'management-api',
  name: 'Management API',
  description: 'Management surface',
  audience: 'https://auth.example.com/api/management',
  enabled: true,
  tokenClaimsNamespace: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const apiScope = {
  id: 'scope-1',
  resourceId: 'resource-1',
  value: 'orders:read',
  description: 'Read orders',
  required: false,
  tokenClaimName: null,
  includeInAccessToken: true,
  includeInIdToken: false,
}

const apiPermission = {
  id: 'permission-1',
  resourceId: 'resource-1',
  scopeId: 'scope-1',
  key: 'orders.read',
  description: 'Read orders',
  tokenClaimValue: 'read',
}

const signInSettings = {
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    magicLinkEnabled: true,
    emailOtpEnabled: false,
    socialLoginEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
  },
  defaults: {
    applicationId: 'app-1',
    redirectUri: 'https://app.example.com/callback',
  },
  links: {
    termsUri: 'https://example.com/terms',
    privacyUri: 'https://example.com/privacy',
    supportEmail: 'support@example.com',
  },
  copy: {
    productName: 'Acme Auth',
    headline: 'Sign in to Acme Auth',
    description: 'Continue with your Acme identity.',
  },
}

const brandingSettings = {
  branding: {
    logoUrl: 'https://cdn.example.com/logo.svg',
    faviconUrl: 'https://cdn.example.com/favicon.ico',
    primaryColor: '#2563eb',
    backgroundColor: '#ffffff',
    customCss: '--auth-panel-radius: 8px;',
  },
  copy: signInSettings.copy,
}

const securityPolicy = {
  policy: {
    mfa: { mode: 'required' },
    passkeys: {
      enabled: true,
      rpId: 'auth.example.com',
      rpName: 'Acme Auth',
      origins: ['https://auth.example.com'],
    },
    sessions: {
      expiresInSeconds: 3600,
      updateAgeSeconds: 300,
      freshAgeSeconds: 120,
      cookieCacheSeconds: 60,
    },
  },
}

const readinessIncomplete = {
  required: [
    {
      id: 'oidc_application',
      label: 'Create an OIDC application',
      description: 'Register the first client so product routes can complete authorization code flows.',
      status: 'action_needed',
      href: '/console/onboarding',
      action: 'Create client',
    },
    {
      id: 'sign_in_method',
      label: 'Enable a sign-in method',
      description: 'Keep at least one hosted sign-in method available for users.',
      status: 'complete',
      href: '/console/sign-in-experience/sign-up-and-sign-in',
      action: 'Review methods',
    },
  ],
  recommended: [
    {
      id: 'email_delivery',
      label: 'Confirm email delivery',
      description: 'Email binding and sender settings are needed for verification, OTP, magic link, and reset flows.',
      status: 'action_needed',
      href: '/console/tenant-settings/oidc-configs',
      action: 'Review deployment',
    },
  ],
  admin: { setupRequired: true, setupHref: '/console/onboarding', missing: ['oidc_application'] },
}

const accountSecurity = {
  mfa: { enabled: false, factors: [] },
  passkeys: { enabled: true, count: 0 },
  policy: {
    mfa: { mode: 'optional' },
    passkeys: { enabled: true, rpName: 'Acme Auth' },
  },
}

const adminSecurity = {
  userId: 'user-1',
  mfa: { enabled: true, factors: [{ id: 'factor-1', type: 'totp', verified: true }] },
  passkeys: { enabled: true, count: 1 },
  policy: {
    mfa: { mode: 'required' },
    passkeys: { enabled: true, rpName: 'Acme Auth' },
  },
}

const adminPasskey = {
  id: 'passkey-1',
  name: 'MacBook Touch ID',
  userId: 'user-1',
  deviceType: 'singleDevice',
  backedUp: true,
  transports: 'internal',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const adminSession = {
  id: 'session-1',
  expiresAt: '2026-01-01T01:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:30:00.000Z',
  ipAddress: '127.0.0.1',
  userAgent: 'Chrome',
  activeOrganizationId: null,
}

const linkedAccount = {
  id: 'account-1',
  accountId: 'github-jane',
  providerId: 'github',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const userApplication = {
  id: 'grant-1',
  applicationId: 'app-1',
  applicationName: 'Customer portal',
  applicationSlug: 'customer-portal',
  scopes: ['openid', 'profile'],
  permissions: ['read:profile'],
  grantedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
}

const configz = {
  onboarding: { required: false, href: '/onboarding' },
  signIn: {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: false,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: false,
    identifierFirst: false,
  },
  branding: {
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    backgroundColor: null,
    customCss: null,
  },
  identityProviders: [],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme',
    headline: 'Sign in to Acme.',
    description: 'Use your workspace identity.',
  },
  defaults: {
    applicationId: null,
    redirectUri: null,
  },
  auth: {
    basePath: '/api/auth',
    signInEmailPath: '/api/auth/sign-in/email',
    signInUsernamePath: '/api/auth/sign-in/username',
    signUpEmailPath: '/api/auth/sign-up/email',
    signOutPath: '/api/auth/sign-out',
    requestPasswordResetPath: '/api/auth/request-password-reset',
    resetPasswordPath: '/api/auth/reset-password',
    sendVerificationEmailPath: '/api/auth/send-verification-email',
    verifyEmailPath: '/api/auth/verify-email',
    magicLinkPath: '/api/auth/sign-in/magic-link',
    emailOtpPath: '/api/auth/email-otp/send-verification-otp',
    emailOtpSignInPath: '/api/auth/sign-in/email-otp',
    emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
    emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
    emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
  },
  oidc: {
    issuer: 'https://auth.example.com/api/auth',
    discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
    authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
    tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
    jwksUri: 'https://auth.example.com/api/auth/jwks',
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  },
  security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
}
