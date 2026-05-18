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
    expect(screen.getByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    expect(screen.getByText('MFA policy')).toBeTruthy()
    expect(screen.getByText('required')).toBeTruthy()
    expect(screen.getByText('Password sign-in')).toBeTruthy()
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
            clientType: 'public_spa',
            redirectUris: ['https://app.example.com/callback'],
          },
        },
      ])
    })
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
            providerType: 'social',
            clientId: 'client-id',
            clientSecretBinding: 'GITHUB_SECRET',
            issuer: 'https://github.com/login/oauth',
            scopes: ['read:user', 'user:email'],
          },
        },
      ])
    })
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

const pagination = {
  limit: 50,
  offset: 0,
  total: 1,
  hasMore: false,
  nextOffset: null,
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
  metadata: null,
  disabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
