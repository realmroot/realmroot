import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter, queryClient } from '@/router'
import {
  AdminDashboardPage,
  AdminOnboardingPage,
  ApiResourcesPage,
  ApplicationsPage,
  BrandingPage,
  ConnectorsPage,
  DeploymentSettingsPage,
  OrganizationsPage,
  RolesPage,
  SecurityPage,
  SignInSettingsPage,
  UsersPage,
} from './admin-console'

afterEach(() => {
  cleanup()
  queryClient.clear()
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
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminDashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Tenant health' })).toBeTruthy()
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

  it('redirects unauthorized admin routes to sign-in with the requested return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings')
        return Promise.resolve(jsonResponse({ error: 'Unauthorized' }, 401))
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(decodeURIComponent(window.location.search)).toContain('return_to=/admin/applications')
  })

  it('redirects forbidden admin routes to sign-in with return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse({ error: 'Forbidden' }, 403))
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/users')

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
      '/admin',
      '/admin/applications',
    ]) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect(await screen.findByRole('heading', { name: 'Create the first admin.' })).toBeTruthy()
      await waitFor(() => expect(window.location.pathname).toBe('/onboarding'))

      cleanup()
      queryClient.clear()
    }
  })

  it('redirects stale first-admin onboarding visits to admin setup', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({
            admin: { setupRequired: true, setupHref: '/admin/onboarding', missing: ['oidc_application'] },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/onboarding')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Admin onboarding' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/admin/onboarding'))
  })

  it('redirects account root to the profile route', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)
    window.history.pushState(null, '', '/account')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/account/profile'))
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

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy()
      expect(window.location.pathname).toBe(path)

      cleanup()
      queryClient.clear()
    }
  })

  it('redirects protected admin routes to admin onboarding while setup is incomplete', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({
            admin: { setupRequired: true, setupHref: '/admin/onboarding', missing: ['oidc_application'] },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Admin onboarding' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/admin/onboarding'))
    expect(screen.queryByRole('link', { name: /Onboarding/ })).toBeNull()
  })

  it('redirects stale admin onboarding visits to the console after setup is complete', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/admin/onboarding', missing: [] } }),
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
    window.history.pushState(null, '', '/admin/onboarding')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Tenant health' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/admin'))
  })

  it('surfaces non-auth admin readiness errors instead of converting them to sign-in redirects', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse({ error: 'Readiness failed.' }, 500))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/applications')

    render(<AppRouter />)

    expect(await screen.findByText('Readiness failed.')).toBeTruthy()
    expect(window.location.pathname).toBe('/admin/applications')
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
            redirectUris: ['https://app.example.com/callback'],
          },
        },
      ])
    })
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
          jsonResponse({ admin: { setupRequired: false, setupHref: '/admin/onboarding', missing: [] } }),
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
    window.history.pushState(null, '', '/admin/applications/app-1')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/authorize')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/token')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/userinfo')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/jwks')).toBeTruthy()
    expect(screen.getByText('No client secret is issued for public clients.')).toBeTruthy()
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
          url: '/api/management/applications/app-1/redirect-uris',
          method: 'PUT',
          body: { redirectUris: ['https://new.example.com/callback'] },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { disabled: true, disabledReason: 'Disabled from admin console' },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { disabled: false, disabledReason: null },
        },
        { url: '/api/management/applications/app-1', method: 'DELETE', body: null },
      ])
    })
    await waitFor(() => expect(window.location.pathname).toBe('/admin/applications'))
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
          jsonResponse({ admin: { setupRequired: false, setupHref: '/admin/onboarding', missing: [] } }),
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
    window.history.pushState(null, '', '/admin/applications/app-1')

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
          jsonResponse({ admin: { setupRequired: false, setupHref: '/admin/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1/redirect-uris' && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ error: { message: 'Redirect URI is not allowed.' } }, 400))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(application))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/admin/applications/app-1')

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

  it('renders connectors, creates a connector, and toggles provider availability', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(connector, 201))
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
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'GitHub' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders sign-in settings and security policy tabs', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByText('Authentication methods')).toBeTruthy()
    expect(screen.getByText('Default redirect URI')).toBeTruthy()
    expect(screen.getByText('support@example.com')).toBeTruthy()

    unmount()
    renderWithQuery(<SecurityPage />)

    expect(await screen.findByText('Multi-factor authentication')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Passkeys' }))
    expect(screen.getByText('auth.example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    expect(screen.getByText('3600s')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: 'New organization' }))
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'northwind' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Northwind' } })
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Northwind Traders' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(1))

    unmount()
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auditor' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Reads audit events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests).toHaveLength(2))

    unmount()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('Management API')).toBeTruthy()
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
        { url: '/api/management/roles', body: { key: 'auditor', name: 'Auditor', description: 'Reads audit events' } },
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

  it('shows client-side validation errors for simple create dialogs', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/roles' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(role, 201))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<RolesPage />)

    expect(await screen.findByText('Admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auditor' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    expect(requests).toEqual([])
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
    expect(await screen.findAllByText('Not set')).toHaveLength(5)

    cleanup()
    renderWithQuery(<SecurityPage />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Passkeys' }))
    expect(screen.getByText('No')).toBeTruthy()

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
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    expect(await screen.findByRole('heading', { name: 'Create application' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create application' })).toBeNull()

    unmount()
    renderWithQuery(<UsersPage />)
    expect(await screen.findByText('No users yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New user' }))
    expect(await screen.findByRole('heading', { name: 'Create user' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create user' })).toBeNull()

    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByText('No connectors yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New connector' }))
    expect(await screen.findByRole('heading', { name: 'Create connector' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create connector' })).toBeNull()

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText('No organizations yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New organization' }))
    expect(await screen.findByRole('heading', { name: 'Create organization' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create organization' })).toBeNull()

    cleanup()
    renderWithQuery(<RolesPage />)
    expect(await screen.findByText('No roles yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New role' }))
    expect(await screen.findByRole('heading', { name: 'Create role' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create role' })).toBeNull()

    cleanup()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('No API resources yet')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
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
        component: <SignInSettingsPage />,
        matches: (url: string) => url === '/api/management/sign-in-settings',
        success: signInSettings,
        text: 'Authentication methods',
      },
      {
        component: <SecurityPage />,
        matches: (url: string) => url === '/api/management/security/policy',
        success: securityPolicy,
        text: 'Multi-factor authentication',
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

  it('renders static branding and deployment settings pages', () => {
    const { unmount } = renderWithQuery(<BrandingPage />)

    expect(screen.getByRole('heading', { name: 'Branding' })).toBeTruthy()
    expect(screen.getByText('FlareAuth')).toBeTruthy()

    unmount()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(screen.getByRole('heading', { name: 'Deployment' })).toBeTruthy()
    expect(screen.getByText('Cloudflare Workers')).toBeTruthy()
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
          jsonResponse({ admin: { setupRequired: false, setupHref: '/admin/onboarding', missing: [] } }),
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
    fireEvent.change(screen.getByLabelText('Upload branding logo'), {
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
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminOnboardingPage />)

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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const signInSettings = {
  signIn: {
    passwordEnabled: true,
    magicLinkEnabled: true,
    emailOtpEnabled: false,
    passkeyEnabled: false,
    socialLoginEnabled: true,
    signupEnabled: true,
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

const accountSecurity = {
  mfa: { enabled: false, factors: [] },
  passkeys: { enabled: true, count: 0 },
  policy: {
    mfa: { mode: 'optional' },
    passkeys: { enabled: true, rpName: 'Acme Auth' },
  },
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
    userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  },
  security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
}
