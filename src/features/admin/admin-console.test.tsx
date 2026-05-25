import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter, queryClient } from '@/router'
import {
  AccountCenterSettingsPage,
  AdminDashboardPage,
  AdminOnboardingPage,
  ApiResourceDetailPage,
  ApiResourcesPage,
  ApplicationDetailPage,
  ApplicationsPage,
  apiResourceDetailTabs,
  BrandingPage,
  ConnectorsPage,
  ConsolePlaceholderPage,
  ContentSettingsPage,
  CustomizeJwtPage,
  clientConfig,
  clientTypeLabel,
  connectorFieldLabel,
  connectorToForm,
  connectorUpdateForm,
  customCssProperties,
  DeploymentSettingsPage,
  dashboardChartLabels,
  formatDashboardDate,
  formatDate,
  formatRole,
  hostedAuthMode,
  listItems,
  listValue,
  MfaPage,
  navigateConsoleTab,
  nullableFormValue,
  nullableString,
  OrganizationDetailPage,
  OrganizationsPage,
  OrganizationTemplatePage,
  organizationDetailTabs,
  parseConnectorMetadata,
  parseCustomData,
  parseLineList,
  parseMetadata,
  parseTokenClaims,
  passwordSignupEnabled,
  previewSignInAction,
  RoleDetailPage,
  RolesPage,
  removeBlankValues,
  roleDetailTabs,
  SecurityBlocklistPage,
  SecurityCaptchaPage,
  SecurityGeneralPage,
  SecurityPasswordPolicyPage,
  SignInSettingsPage,
  shallowEqual,
  UserDetailPage,
  UsersPage,
  userDetailTabs,
  userDisplayName,
  WebhooksPage,
} from './admin-console'

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

describe('admin console', () => {
  it('normalizes admin console pure helpers', () => {
    expect(hostedAuthMode({ passwordEnabled: true } as Parameters<typeof hostedAuthMode>[0])).toBe('password')
    expect(
      hostedAuthMode({ passwordEnabled: false, emailOtpEnabled: true } as Parameters<typeof hostedAuthMode>[0]),
    ).toBe('otp')
    expect(
      hostedAuthMode({ passwordEnabled: false, emailOtpEnabled: false } as Parameters<typeof hostedAuthMode>[0]),
    ).toBeNull()
    expect(
      passwordSignupEnabled({ signupEnabled: true, passwordEnabled: true } as Parameters<
        typeof passwordSignupEnabled
      >[0]),
    ).toBe(true)
    expect(
      passwordSignupEnabled({ signupEnabled: true, passwordEnabled: false } as Parameters<
        typeof passwordSignupEnabled
      >[0]),
    ).toBe(false)
    expect(previewSignInAction('otp')).toBe('Send code')
    expect(previewSignInAction('password')).toBe('Sign in')
    const navigate = vi.fn()
    window.history.pushState(null, '', '/console/users/user-1')
    navigateConsoleTab(navigate, '/console/users/user-1/security')
    expect(navigate).toHaveBeenCalledWith({ to: '/console/users/user-1/security' })
    window.history.pushState(null, '', '/profile')
    navigateConsoleTab(navigate, '/console/users/user-1/security')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(userDetailTabs().map((tab) => tab.value)).toContain('linked-accounts')
    expect(organizationDetailTabs().map((tab) => tab.value)).toEqual(['settings', 'authorization'])
    expect(roleDetailTabs().map((tab) => tab.value)).toContain('permissions')
    expect(apiResourceDetailTabs().map((tab) => tab.value)).toContain('scopes')
    expect(formatDashboardDate(new Date('2026-05-01T12:00:00.000Z'))).toBe('2026-05-01')
    expect(dashboardChartLabels(new Date('2026-05-29T00:00:00.000Z'))).toHaveLength(8)
    expect(listItems(['a', 'b'])).toEqual(['a', 'b'])
    expect(listItems(undefined)).toEqual([])
    expect(listValue(['openid', 'email'], ' ')).toBe('openid email')
    expect(clientTypeLabel('public_spa')).toBe('Public SPA')
    expect(clientTypeLabel('public_native')).toBe('Public native')
    expect(clientTypeLabel('confidential_web')).toBe('Confidential web')
    expect(removeBlankValues({ a: '', b: 'value' })).toEqual({ b: 'value' })
    expect(removeBlankValues(null)).toBeNull()
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(nullableString(' value ')).toBe('value')
    expect(nullableString('   ')).toBeNull()
    expect(parseTokenClaims('')).toBeUndefined()
    expect(parseTokenClaims('{"role":"admin"}')).toEqual({ role: 'admin' })
    expect(parseLineList(' a\n\n b ')).toEqual(['a', 'b'])
    expect(parseCustomData('')).toEqual({})
    expect(parseCustomData('{"tier":"pro"}')).toEqual({ tier: 'pro' })
    expect(() => parseCustomData('[]')).toThrow('Custom data JSON must be an object.')
    expect(customCssProperties(':root { color: red; }')).toEqual({})
    expect(customCssProperties('--auth-primary: #111; --auth-background: #fff;')).toEqual({
      '--auth-primary': '#111',
      '--auth-background': '#fff',
    })
    expect(formatDate(undefined)).toBe('Unknown')
    expect(formatRole(['admin', 'owner'])).toBe('admin, owner')
    expect(formatRole(null)).toBe('user')
    expect(userDisplayName({ ...user, displayName: 'Jane' })).toBe('Jane')
    expect(
      userDisplayName({ ...user, displayName: undefined, name: 'Jane Stone' } as Parameters<typeof userDisplayName>[0]),
    ).toBe('Jane Stone')
    expect(
      userDisplayName({ ...user, displayName: undefined, name: undefined } as Parameters<typeof userDisplayName>[0]),
    ).toBe(user.email)
    const config = JSON.parse(clientConfig(application as Parameters<typeof clientConfig>[0], 'secret')) as {
      clientSecret?: string
      redirectUris: string[]
    }
    expect(config.clientSecret).toBe('secret')
    expect(config.redirectUris).toEqual(application.redirectUris)
    expect(JSON.parse(clientConfig(application as Parameters<typeof clientConfig>[0], null))).not.toHaveProperty(
      'clientSecret',
    )
  })

  it('normalizes connector form helper values', () => {
    expect(parseMetadata(undefined)).toBeUndefined()
    expect(parseMetadata('   ')).toBeUndefined()
    expect(parseMetadata('{"prompt":"consent"}')).toEqual({ prompt: 'consent' })
    expect(() => parseMetadata('[]')).toThrow('Provider metadata must be a JSON object.')
    expect(() => parseMetadata('null')).toThrow('Provider metadata must be a JSON object.')

    expect(
      parseConnectorMetadata({
        providerMetadata: '{"scope":"openid"}',
        'metadata.allowUsersWithoutEmail': 'true',
        'metadata.empty': '',
        'metadata.prompt': 'select_account',
      } as Parameters<typeof parseConnectorMetadata>[0]),
    ).toEqual({
      scope: 'openid',
      allowUsersWithoutEmail: true,
      prompt: 'select_account',
    })
    expect(
      parseConnectorMetadata({ providerMetadata: '' } as Parameters<typeof parseConnectorMetadata>[0]),
    ).toBeUndefined()
    expect(connectorFieldLabel('clientIDRedirectURI')).toBe('Client ID Redirect URI')
    expect(nullableFormValue('')).toBeNull()
    expect(nullableFormValue('value')).toBe('value')
    expect(
      connectorUpdateForm({
        clientId: '',
        clientSecret: '  secret  ',
        issuer: '',
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: '',
        userInfoEndpoint: '',
        jwksEndpoint: '',
      } as Parameters<typeof connectorUpdateForm>[0]),
    ).toEqual(
      expect.objectContaining({
        clientId: null,
        clientSecret: 'secret',
        issuer: null,
        authorizationEndpoint: 'https://auth.example.com/authorize',
        tokenEndpoint: null,
      }),
    )
    expect(
      (
        connectorUpdateForm({
          clientId: 'client-1',
          clientSecret: '   ',
          issuer: 'https://issuer.example.com',
          authorizationEndpoint: '',
          tokenEndpoint: '',
          userInfoEndpoint: '',
          jwksEndpoint: '',
        } as Parameters<typeof connectorUpdateForm>[0]) as { clientSecret: string }
      ).clientSecret,
    ).toBe('   ')
    expect(connectorToForm(null).slug).toBeUndefined()
    expect(connectorToForm(connector as Parameters<typeof connectorToForm>[0]).slug).toBe(connector.slug)
    expect(
      connectorToForm({
        ...connector,
        providerMetadata: { allowUsersWithoutEmail: true },
      } as Parameters<typeof connectorToForm>[0]).providerMetadata,
    ).toBe('{\n  "allowUsersWithoutEmail": true\n}')
  })

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
      if (url.startsWith('/api/management/roles')) return Promise.resolve(jsonResponse({ roles: [role], pagination }))
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AdminDashboardPage />)

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

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(metricValue('Total users')).toBe('0')
    expect(screen.getAllByText('--').length).toBeGreaterThanOrEqual(5)
    expect(screen.getAllByText('Pending')).toHaveLength(4)
    expect(screen.queryByText('Setup progress')).toBeNull()
    expect(screen.queryByText('Private cloud')).toBeNull()
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
    const requestedUrls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ error: 'Authentication is required.' }, 401))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(decodeURIComponent(window.location.search)).toContain('return_to=/console/applications')
    expect(requestedUrls.filter((url) => url !== '/api/configz')[0]).toBe('/api/account/profile')
    expect(requestedUrls).not.toContain('/api/management/sign-in-settings')
    expect(requestedUrls).not.toContain('/api/management/readiness')
  })

  it('redirects signed-in non-admin Console routes before management requests', async () => {
    const requestedUrls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: { ...profile, role: 'user' } }))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/users')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(decodeURIComponent(window.location.search)).toContain('return_to=/console/users')
    expect(requestedUrls.filter((url) => url !== '/api/configz')[0]).toBe('/api/account/profile')
    expect(requestedUrls).not.toContain('/api/management/sign-in-settings')
    expect(requestedUrls).not.toContain('/api/management/readiness')
  })

  it('redirects forbidden Console routes to sign-in with return target', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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

  it('surfaces non-auth Console account guard errors before management requests', async () => {
    const requestedUrls: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ error: 'Profile unavailable.' }, 503))
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/users')

    render(<AppRouter />)

    expect(await screen.findByText('Profile unavailable.')).toBeTruthy()
    expect(window.location.pathname).toBe('/console/users')
    expect(requestedUrls).toContain('/api/account/profile')
    expect(requestedUrls).not.toContain('/api/management/sign-in-settings')
    expect(requestedUrls).not.toContain('/api/management/readiness')
  })

  it('redirects signed-out profile route to sign-in before rendering account controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile')
        return Promise.resolve(jsonResponse({ error: 'Authentication is required.' }, 401))
      return Promise.resolve(jsonResponse({}))
    })

    window.history.pushState(null, '', '/profile')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/sign-in'))
    expect(new URLSearchParams(window.location.search).get('return_to')).toBe('/profile')
    expect(screen.queryByRole('navigation', { name: 'Account center' })).toBeNull()
  })

  it('renders the top-level profile entry route and redirects legacy profile sections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)

    for (const path of [
      '/profile',
      '/profile/security',
      '/profile/linked-accounts',
      '/profile/sessions',
      '/profile/authorized-apps',
    ]) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      await waitFor(() => expect(window.location.pathname).toBe('/profile'))
      expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()

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
    window.history.pushState(null, '', '/profile')

    render(<AppRouter />)

    expect(await screen.findByText('Profile unavailable.')).toBeTruthy()
    expect(window.location.pathname).toBe('/profile')
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

    for (const path of ['/', '/sign-in', '/sign-up', '/profile', '/account', '/console', '/console/applications']) {
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
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/onboarding')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Console setup' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/onboarding'))
  })

  it('redirects account root to the canonical profile page', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)
    window.history.pushState(null, '', '/account')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/profile'))
  })

  it('redirects legacy account section routes to the canonical profile page', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(accountRouteFetch)

    for (const path of [
      '/account/profile',
      '/account/security',
      '/account/linked-accounts',
      '/account/sessions',
      '/account/authorized-apps',
    ] as const) {
      window.history.pushState(null, '', path)
      render(<AppRouter />)

      expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
      await waitFor(() => expect(window.location.pathname).toBe('/profile'))
      expect(screen.queryByRole('navigation', { name: 'Account center' })).toBeNull()
      expect(screen.getByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Linked accounts' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Active sessions' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Authorized apps' })).toBeTruthy()

      cleanup()
      queryClient.clear()
    }
  })

  it('allows protected Console routes while setup checklist is incomplete', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
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
      return Promise.resolve(jsonResponse({}))
    })
    window.history.pushState(null, '', '/console/applications')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/applications'))
  })

  it('redirects stale Console setup visits to the Console after setup is complete', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
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

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console'))
  })

  it('renders canonical Console routes and default nested redirects', async () => {
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
      ['/console/sign-in-experience/desktop', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
      ['/console/sign-in-experience/mobile', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
      ['/console/sign-in-experience/branding', '/console/sign-in-experience/branding', 'Branding'],
      [
        '/console/sign-in-experience/collect-user-profile',
        '/console/sign-in-experience/sign-up-and-sign-in',
        'Sign-up and sign-in',
      ],
      ['/console/sign-in-experience/account-center', '/console/sign-in-experience/account-center', 'Account Center'],
      ['/console/sign-in-experience/content', '/console/sign-in-experience/content', 'Content'],
      ['/console/security', '/console/security/captcha', 'CAPTCHA'],
      ['/console/security/password-policy', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
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

  it('navigates sign-in experience tabs through routable tab links', async () => {
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

  it('redirects old admin links to matching Console routes', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)

    for (const [path, finalPath, heading] of [
      ['/admin/sign-in', '/console/sign-in-experience/sign-up-and-sign-in', 'Sign-up and sign-in'],
      ['/admin/branding', '/console/sign-in-experience/branding', 'Branding'],
      ['/admin/connectors', '/console/connectors', 'Connectors'],
      ['/admin/security', '/console/security/captcha', 'CAPTCHA'],
      ['/admin/deployment', '/console/tenant-settings/oidc-configs', 'Settings'],
      ['/admin/applications/app-1', '/console/applications/app-1/settings', 'Customer portal'],
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
    expect(screen.getByRole('link', { name: 'Branding' })).toHaveProperty(
      'href',
      `${window.location.origin}/console/sign-in-experience/branding`,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Branding' }))

    expect(await screen.findByRole('heading', { name: 'Branding' })).toBeTruthy()
    await waitFor(() => expect(window.location.pathname).toBe('/console/sign-in-experience/branding'))
  })

  it('renders authorization detail routes with route params', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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
        return Promise.resolve(jsonResponse({ sessions: [adminSession], pagination }))
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
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [adminPasskey], pagination }))
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
      return Promise.resolve(jsonResponse({}))
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

  it('surfaces non-auth admin readiness errors instead of converting them to sign-in redirects', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
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
    expect(screen.getByRole('columnheader', { name: 'Client ID' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Ownership' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: 'missing' } })
    expect(await screen.findByText('No applications found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: 'Customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Admin console' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'admin-console' } })
    fireEvent.click(screen.getByRole('button', { name: /Traditional web app/ }))
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
    const createRedirectUrisInput = screen.getByLabelText('Redirect URIs')
    createRedirectUrisInput.removeAttribute('required')
    fireEvent.change(createRedirectUrisInput, {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Too small: expected array to have >=1 items')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Traditional web app/ }))
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://server.example.com/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('heading', { name: 'Application created' })).toBeTruthy()
    expect(screen.getAllByText('Client ID').length).toBeGreaterThan(0)
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
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0])
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

  it('renders application list rows with compact client metadata', async () => {
    const thirdPartyApplication = { ...application, id: 'app-2', firstParty: false, name: 'Partner app' }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application, thirdPartyApplication], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('My app')).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    expect(screen.getByText('Public SPA')).toBeTruthy()
    expect(screen.queryByLabelText('Upload logo for Customer portal')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Third-party apps' }))
    expect(await screen.findByText('Partner app')).toBeTruthy()
    expect(screen.getByText('Third-party')).toBeTruthy()
    expect(screen.queryByLabelText('Upload logo for Partner app')).toBeNull()
  })

  it('renders application detail lifecycle, redirect/origin/custom-data editing, and integration controls', async () => {
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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
    expect(screen.getByLabelText('Post sign-out redirect URIs')).toHaveProperty(
      'value',
      'https://app.example.com/signed-out',
    )
    expect(screen.getByLabelText('CORS origins')).toHaveProperty('value', 'https://app.example.com')
    expect(screen.getByLabelText('Custom data JSON')).toHaveProperty('value', '{\n  "plan": "enterprise"\n}')
    expect(screen.queryByText('Backchannel logout')).toBeNull()
    expect(screen.queryByText('Token exchange')).toBeNull()
    expect(screen.queryByText('Concurrent device limit')).toBeNull()
    expect(screen.getByText('https://auth.example.com/authorize')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/token')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/userinfo')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/jwks')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Access token roles' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'ID token roles' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'UserInfo organization name' }).getAttribute('aria-checked')).toBe(
      'false',
    )
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
      postLogoutRedirectUris: ['https://app.example.com/signed-out'],
      corsOrigins: ['https://app.example.com'],
      scopes: 'openid profile',
      tokenEndpointAuthMethod: 'none',
      customData: { plan: 'enterprise' },
    })

    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://new.example.com/callback' },
    })
    fireEvent.change(screen.getByLabelText('Post sign-out redirect URIs'), {
      target: { value: 'https://new.example.com/signed-out' },
    })
    fireEvent.change(screen.getByLabelText('CORS origins'), {
      target: { value: 'https://new.example.com\nhttp://localhost:4173' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirects and origins' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: {
          redirectUris: ['https://new.example.com/callback'],
          postLogoutRedirectUris: ['https://new.example.com/signed-out'],
          corsOrigins: ['https://new.example.com', 'http://localhost:4173'],
        },
      })
    })

    const redirectUrisInput = screen.getByLabelText('Redirect URIs')
    redirectUrisInput.removeAttribute('required')
    fireEvent.change(redirectUrisInput, {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirects and origins' }))
    expect(await screen.findByText('Too small: expected array to have >=1 items')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { customData: {} },
      })
    })

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '{"plan":"growth","beta":true}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { customData: { plan: 'growth', beta: true } },
      })
    })

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '["not-an-object"]' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    expect(await screen.findByText('Custom data JSON must be an object.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { customData: {} },
      })
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Access token organization ID' }))
    fireEvent.click(screen.getByRole('switch', { name: 'ID token roles' }))
    fireEvent.click(screen.getByRole('switch', { name: 'ID token permissions' }))
    fireEvent.click(screen.getByRole('switch', { name: 'UserInfo organization name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save OIDC claims' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: {
          oidcClaims: {
            accessToken: {
              authorization: true,
              roles: true,
              permissions: true,
              organizationId: true,
            },
            idToken: {
              roles: true,
              permissions: true,
            },
            userInfo: {
              organizationName: true,
            },
          },
        },
      })
    })
    expect(screen.getByRole('switch', { name: 'Access token organization ID' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.queryByLabelText('Client secret')).toBeNull()

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '{"plan":"discarded"}' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard' }).at(-1) as HTMLButtonElement)
    expect(screen.getByLabelText('Custom data JSON')).toHaveProperty('value', '{}')
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
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: {
            redirectUris: ['https://new.example.com/callback'],
            postLogoutRedirectUris: ['https://new.example.com/signed-out'],
            corsOrigins: ['https://new.example.com', 'http://localhost:4173'],
          },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { customData: {} },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { customData: { plan: 'growth', beta: true } },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { customData: {} },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: {
            oidcClaims: {
              accessToken: {
                authorization: true,
                roles: true,
                permissions: true,
                organizationId: true,
              },
              idToken: {
                roles: true,
                permissions: true,
              },
              userInfo: {
                organizationName: true,
              },
            },
          },
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByText('fas_rotated_secret')).toBeNull())
  })

  it('retries application detail loading failures', async () => {
    const requests: string[] = []
    let detailAttempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1') {
        detailAttempts += 1
        if (detailAttempts === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Application unavailable.' } }, 503))
        }
        return Promise.resolve(jsonResponse(application))
      }
      if (url === '/api/management/applications/app-1/client-secrets') {
        return Promise.resolve(jsonResponse({ secrets: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByText('Application unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(requests.filter((url) => url === '/api/management/applications/app-1')).toHaveLength(2)
  })

  it('keeps application detail rendering stable when optional list fields are absent from the API response', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1') {
        const {
          corsOrigins: _corsOrigins,
          postLogoutRedirectUris: _postLogoutRedirectUris,
          redirectUris: _redirectUris,
          ...partial
        } = application
        return Promise.resolve(jsonResponse(partial))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByLabelText('Redirect URIs')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Post sign-out redirect URIs')).toHaveProperty('value', '')
    expect(screen.getByLabelText('CORS origins')).toHaveProperty('value', '')
  })

  it('renders application detail mutation errors at the operation boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (url === '/api/management/applications/app-1' && init?.method === 'PATCH') {
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
    fireEvent.click(screen.getByRole('button', { name: 'Save redirects and origins' }))

    expect((await screen.findAllByText('Redirect URI is not allowed.')).length).toBeGreaterThan(0)
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
    expect(screen.getByLabelText('Username').getAttribute('autocomplete')).toBe('username')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sam' } })
    expect(screen.getByLabelText('Initial password').getAttribute('autocomplete')).toBe('new-password')
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
    expect(await screen.findByRole('button', { name: 'Previous' })).toHaveProperty('disabled', true)
    expect(await screen.findByRole('button', { name: 'Next' })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await waitFor(() => {
      expect(requests.at(-1)).toContain('role=admin')
      expect(requests.at(-1)).toContain('banned=true')
      expect(requests.at(-1)).toContain('offset=0')
    })

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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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
    expect(window.location.pathname).toBe('/console/users/user-1/profile')
    expect(screen.getByRole('tab', { name: 'Profile' }).getAttribute('aria-selected')).toBe('true')
    expect(summaryCard('Identity summary').getByText('User ID')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('user-1')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('jane@example.com')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('admin')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }))
    expect(screen.getByText('MFA and passkeys')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('Account status')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
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
    await waitFor(() => {
      const summary = summaryCard('Identity summary')
      expect(summary.getByText('Sessions')).toBeTruthy()
      expect(summary.getByText('Linked accounts')).toBeTruthy()
      expect(summary.getByText('Authorized apps')).toBeTruthy()
      expect(summary.getAllByText('1').length).toBeGreaterThanOrEqual(3)
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Jane Q. Stone' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'user' } })
    fireEvent.change(screen.getByLabelText('Email verification'), { target: { value: 'false' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Save profile' }).closest('form')!)
    await waitFor(() => expect(requests).toHaveLength(1))
    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send password reset' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }))
    await waitFor(() => expect(requests).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sessions' }))
    await waitFor(() => expect(requests).toHaveLength(4))
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete passkey' }))
    await waitFor(() => expect(requests).toHaveLength(5))
    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
    expect(screen.getByText('abuse')).toBeTruthy()
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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

    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Ban user' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }))
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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
    expect(screen.getByRole('button', { name: 'Save profile' }).closest('form')?.noValidate).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }))
    expect(screen.getAllByText('Disabled')).toHaveLength(2)
    expect(screen.getByText('sms')).toBeTruthy()
    expect(screen.getByText('passkey-1')).toBeTruthy()
    expect(screen.getByText(/not backed up/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    expect(screen.getByText(/Unknown IP/)).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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

  it('renders the provider catalog and configures social providers from the drawer', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(connector, 201))
      }
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Email')).toBeTruthy()
    expect(screen.getByText('Phone (SMS)')).toBeTruthy()
    expect(screen.getByText('Web3 wallet')).toBeTruthy()
    expect(screen.getByText('Passkey')).toBeTruthy()
    expect(screen.getByText('OneTap')).toBeTruthy()
    expect(screen.getByText('Google')).toBeTruthy()
    expect(
      Array.from(screen.getByRole('table').querySelectorAll('tbody tr'))
        .map((row) => row.querySelector('.font-medium')?.textContent)
        .slice(0, 5),
    ).toEqual(['Email', 'Phone (SMS)', 'Web3 wallet', 'Passkey', 'OneTap'])
    expect(screen.queryByRole('link', { name: 'Passwordless' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Social' })).toBeNull()
    expect(screen.queryByLabelText('Search social connectors')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add social connector' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Google.*Credentials required.*Not enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    expect(screen.getByLabelText('Callback URL')).toHaveProperty(
      'value',
      'http://localhost:3000/api/auth/callback/google',
    )
    const fieldLabels = Array.from(screen.getByRole('dialog').querySelectorAll('.field label')).map(
      (label) => label.textContent,
    )
    expect(fieldLabels.at(-1)).toBe('Callback URL')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/api/auth/callback/google')
    expect(screen.getAllByText('Required by this Better Auth provider.')).toHaveLength(2)
    expect(screen.queryByLabelText('Scopes')).toBeNull()
    expect(screen.queryByLabelText('Redirect URI')).toBeNull()
    expect(screen.queryByLabelText('Disable Sign Up')).toBeNull()
    expect(screen.queryByLabelText('Override User Info')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'google-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'GOOGLE_SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/connectors',
          body: {
            slug: 'google',
            displayName: 'Google',
            enabled: true,
            providerId: 'google',
            providerType: 'social',
            clientId: 'google-client',
            clientSecret: 'GOOGLE_SECRET',
            scopes: ['openid', 'email', 'profile'],
          },
        },
      ])
    })
  })

  it('configures built-in email and passkey providers from the drawer', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      if (url === '/api/management/sign-in-settings' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            builtInProviders: {
              ...signInSettings.builtInProviders,
              email: { ...signInSettings.builtInProviders.email, enabled: false },
            },
            signIn: { ...signInSettings.signIn, emailOtpEnabled: false },
          }),
        )
      }
      if (url === '/api/management/sign-in-settings' && method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(
          jsonResponse({ ...signInSettings, signIn: { ...signInSettings.signIn, emailOtpEnabled: true } }),
        )
      }
      if (url === '/api/management/security/policy' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            policy: { ...securityPolicy.policy, passkeys: { ...securityPolicy.policy.passkeys, enabled: false } },
          }),
        )
      }
      if (url === '/api/management/security/policy' && method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse(securityPolicy))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Email.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Email' })).getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('OTP length'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Code expiry seconds'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: { builtInProviders: { email: { enabled: true, otpLength: 8, expiresInSeconds: 600 } } },
      })
    })

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Email' })).getAllByRole('button', { name: 'Close' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Passkey.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Passkey' })).getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        body: { policy: { passkeys: { enabled: true } } },
      })
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Passkey' })).getAllByRole('button', { name: 'Close' })[0],
    )
    fireEvent.click(await screen.findByRole('button', { name: /Phone \(SMS\).*Runtime disabled.*Not enabled/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Phone (SMS)' })).getByRole('switch', { name: 'Enabled' }),
    )
    expect(
      Array.from(screen.getByLabelText('SMS provider').querySelectorAll('option')).map((option) => option.value),
    ).toEqual(['twilio', 'vonage', 'messagebird'])
    fireEvent.change(screen.getByLabelText('SMS provider'), { target: { value: 'vonage' } })
    expect(screen.getByLabelText('Vonage API key')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('SMS provider'), { target: { value: 'twilio' } })
    fireEvent.change(screen.getByLabelText('Twilio Account SID'), { target: { value: 'AC123' } })
    fireEvent.change(screen.getByLabelText('Twilio Auth Token'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('From number'), { target: { value: '+15551234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: {
          builtInProviders: {
            phone: expect.objectContaining({
              enabled: true,
              smsProvider: 'twilio',
              twilioAccountSid: 'AC123',
              twilioAuthToken: 'secret',
              twilioFromNumber: '+15551234567',
            }),
          },
        },
      })
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Phone (SMS)' })).getAllByRole('button', { name: 'Close' })[0],
    )
    fireEvent.click(await screen.findByRole('button', { name: /Web3 wallet.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Web3 wallet' })).getByRole('switch', { name: 'Enabled' }),
    )
    expect(screen.queryByLabelText('SIWE domain')).toBeNull()
    expect(screen.queryByLabelText('Email domain')).toBeNull()
    fireEvent.click(screen.getByLabelText('Base'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: {
          builtInProviders: {
            web3Wallet: expect.objectContaining({
              enabled: true,
              chains: [1, 8453],
            }),
          },
        },
      })
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Web3 wallet' })).getAllByRole('button', { name: 'Close' })[0],
    )
    fireEvent.click(await screen.findByRole('button', { name: /OneTap.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'OneTap' })).getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'google-client-id' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: {
          builtInProviders: {
            oneTap: expect.objectContaining({
              enabled: true,
              clientId: 'google-client-id',
            }),
          },
        },
      })
    })
  })

  it('edits and deletes configured social providers from the drawer', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors/connector-1' && method === 'GET') {
        return Promise.resolve(jsonResponse(connector))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'PATCH') {
        requests.push({ url, method, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ ...connector, enabled: false }))
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

    fireEvent.click(await screen.findByRole('button', { name: /Google.*Credentials configured.*Enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy())
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'workspace-client' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/connectors/connector-1',
        method: 'PATCH',
        body: expect.objectContaining({ clientId: 'workspace-client', enabled: false }),
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Google' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /Google.*Credentials configured.*Enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Google' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'Delete connector' })).toBeTruthy()
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(requests).toContainEqual({ url: '/api/management/connectors/connector-1', method: 'DELETE', body: null })
    })
  })

  it('closes the connector drawer from the overlay', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Google.*Credentials required.*Not enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!
    fireEvent.pointerDown(overlay)
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Google' })).toBeNull())
  })

  it('renders Better Auth provider-specific connector fields', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          jsonResponse({ ...connector, providerId: 'cognito', displayName: 'Amazon Cognito' }, 201),
        )
      }
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Amazon Cognito.*Credentials required.*Not enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Amazon Cognito' })).toBeTruthy()
    expect(screen.getByLabelText('Callback URL')).toHaveProperty(
      'value',
      'http://localhost:3000/api/auth/callback/cognito',
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cognito-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'COGNITO_SECRET' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'auth.example.com' } })
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us-east-1' } })
    fireEvent.change(screen.getByLabelText('User Pool ID'), { target: { value: 'pool-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/connectors',
          body: {
            slug: 'cognito',
            displayName: 'Amazon Cognito',
            enabled: true,
            providerId: 'cognito',
            providerType: 'social',
            clientId: 'cognito-client',
            clientSecret: 'COGNITO_SECRET',
            scopes: ['openid', 'email', 'profile'],
            providerMetadata: {
              domain: 'auth.example.com',
              region: 'us-east-1',
              userPoolId: 'pool-1',
            },
          },
        },
      ])
    })
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

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Identifier-first flow' })).toBeNull()
    expect(screen.queryByText('Recovery and redirects')).toBeNull()
    expect(screen.queryByText('Hosted copy source')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Passkey sign-in' })).toBeNull()

    unmount()
    renderWithQuery(<MfaPage />)

    expect(await screen.findByText('Factors')).toBeTruthy()
    expect(screen.getByText('Passkeys')).toBeTruthy()
    expect(screen.getByText('Authenticator app')).toBeTruthy()
    expect(screen.queryByText('SMS verification code')).toBeNull()
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('value', 'required')
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<SecurityGeneralPage />)
    expect(await screen.findByText('3600s')).toBeTruthy()
  })

  it('renders independent MFA, security, connector, and OIDC settings surfaces', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<MfaPage />)
    expect(await screen.findByText('Backup codes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Prompt policy'), { target: { value: 'optional' } })
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)
    expect(await screen.findByLabelText('Minimum length')).toHaveProperty('disabled', false)
    expect(screen.getByText('Reject repetitive or sequential characters')).toBeTruthy()
    expect(screen.getByLabelText('Required character types')).toHaveProperty('value', '2')

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)
    expect(await screen.findByText('Turnstile')).toBeTruthy()
    expect(screen.getByLabelText('Site key')).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)
    expect(await screen.findByText('Block email subaddressing')).toBeTruthy()
    expect(screen.getByLabelText('Custom email and domain blocklist')).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect((await screen.findAllByText('Provider')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Email.*Runtime enabled.*Enabled/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Phone \(SMS\).*Runtime disabled.*Not enabled/ })).toBeTruthy()
    expect(screen.queryByLabelText('Search social connectors')).toBeNull()

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)
    expect(await screen.findByText('Signing keys')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rotate key' })).toBeNull()
  })

  it('renders editable MFA and password policy compact controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url.startsWith('/api/management/webhooks/endpoints')) {
        return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
      }
      if (url.startsWith('/api/management/webhooks/requests')) {
        return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<MfaPage />)

    expect(await screen.findByText('Authenticator app')).toBeTruthy()
    expect(screen.queryByText('SMS verification code')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Email verification code' }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveProperty('disabled', false)

    unmount()
    renderWithQuery(<SecurityPasswordPolicyPage />)

    expect(await screen.findByLabelText('Minimum length')).toHaveProperty('value', '12')
    for (const name of [
      'Reject repetitive or sequential characters',
      'Reject user information',
      'Reject custom words',
    ]) {
      expect(screen.getByRole('switch', { name })).toHaveProperty('disabled', false)
    }
  })

  it('saves security policy changes through the management boundary', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/security/policy' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        requests.push({ url, method, body })
        return Promise.resolve(
          jsonResponse({
            policy: {
              ...securityPolicy.policy,
              ...(body.policy as object),
            },
          }),
        )
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<MfaPage />)

    fireEvent.change(await screen.findByLabelText('Prompt policy'), { target: { value: 'optional' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/security/policy',
          method: 'PATCH',
          body: {
            policy: {
              mfa: {
                mode: 'optional',
                authenticatorAppEnabled: true,
                emailOtpEnabled: false,
                backupCodesEnabled: true,
              },
              passkeys: { enabled: true },
            },
          },
        },
      ]),
    )

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)

    fireEvent.change(await screen.findByLabelText('Minimum length'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('Required character types'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Reject custom words' }))
    fireEvent.change(screen.getByLabelText('Custom words'), { target: { value: 'tenant\ninternal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in settings' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        method: 'PATCH',
        body: {
          policy: {
            passkeys: { enabled: false },
            password: {
              minLength: 14,
              requiredCharacterTypes: 3,
              customWords: ['tenant', 'internal'],
              rejectUserInfo: true,
              rejectSequential: true,
              rejectCustomWords: true,
            },
          },
        },
      }),
    )

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable CAPTCHA' }))
    fireEvent.change(screen.getByLabelText('Site key'), { target: { value: 'site-key-1' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'TURNSTILE_SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        method: 'PATCH',
        body: {
          policy: {
            captcha: {
              enabled: true,
              provider: 'turnstile',
              siteKey: 'site-key-1',
              secretBinding: 'TURNSTILE_SECRET',
            },
          },
        },
      }),
    )

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Block email subaddressing' }))
    fireEvent.change(screen.getByLabelText('Custom email and domain blocklist'), {
      target: { value: 'blocked@example.com\nblocked.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        method: 'PATCH',
        body: {
          policy: {
            blocklist: {
              blockSubaddressing: true,
              entries: ['blocked@example.com', 'blocked.test'],
            },
          },
        },
      }),
    )
  })

  it('resets security policy form edits to persisted values', async () => {
    const policy = {
      policy: {
        ...securityPolicy.policy,
        mfa: { mode: 'optional' },
        passkeys: { ...securityPolicy.policy.passkeys, enabled: false },
        password: {
          minLength: 10,
          requiredCharacterTypes: 1,
          customWords: ['legacy'],
          rejectUserInfo: false,
          rejectSequential: false,
          rejectCustomWords: true,
        },
        captcha: {
          enabled: true,
          provider: 'turnstile',
          siteKey: 'persisted-site',
          secretBinding: 'PERSISTED_SECRET',
        },
        blocklist: {
          blockSubaddressing: true,
          entries: ['persisted.example'],
        },
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(policy))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<MfaPage />)
    expect(await screen.findByLabelText('Prompt policy')).toHaveProperty('value', 'optional')
    expect(screen.getByRole('switch', { name: 'Passkeys' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText('Prompt policy'), { target: { value: 'required' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('value', 'optional')

    unmount()
    renderWithQuery(<SecurityPasswordPolicyPage />)
    fireEvent.change(await screen.findByLabelText('Minimum length'), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('Required character types'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Custom words'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Reject repetitive or sequential characters' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Reject user information' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Reject custom words' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Minimum length')).toHaveProperty('value', '10')
    expect(screen.getByLabelText('Required character types')).toHaveProperty('value', '1')
    expect(screen.getByLabelText('Custom words')).toHaveProperty('value', 'legacy')
    expect(
      screen.getByRole('switch', { name: 'Reject repetitive or sequential characters' }).getAttribute('aria-checked'),
    ).toBe('false')
    expect(screen.getByRole('switch', { name: 'Reject user information' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Reject custom words' }).getAttribute('aria-checked')).toBe('true')

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)
    expect(await screen.findByLabelText('Site key')).toHaveProperty('value', 'persisted-site')
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'turnstile' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable CAPTCHA' }))
    fireEvent.change(screen.getByLabelText('Site key'), { target: { value: 'changed-site' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'CHANGED_SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Enable CAPTCHA' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Site key')).toHaveProperty('value', 'persisted-site')
    expect(screen.getByLabelText('Client secret')).toHaveProperty('value', 'PERSISTED_SECRET')

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Block email subaddressing' }))
    fireEvent.change(screen.getByLabelText('Custom email and domain blocklist'), {
      target: { value: 'changed.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Block email subaddressing' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Custom email and domain blocklist')).toHaveProperty('value', 'persisted.example')

    cleanup()
    renderWithQuery(<SecurityGeneralPage />)
    expect(await screen.findByText('Enabled for hosted flows')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('10 characters')).toBeTruthy()
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

    const { unmount } = renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Sign-in settings unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/sign-in-settings').length).toBe(2))

    unmount()
    renderWithQuery(<SecurityGeneralPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const generalPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        generalPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)

    expect(await screen.findByText('Sign-in settings unavailable.')).toBeTruthy()
    const passwordPolicyRequests = requests.filter((url) => url === '/api/management/sign-in-settings').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/sign-in-settings').length).toBeGreaterThan(
        passwordPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const captchaPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        captchaPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const blocklistPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        blocklistPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const deploymentPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        deploymentPolicyRequests,
      ),
    )
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
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Passwordless' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow sign up' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social login' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in settings' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      url: '/api/management/sign-in-settings',
      body: {
        signIn: {
          passwordEnabled: false,
          signupEnabled: false,
          socialLoginEnabled: false,
        },
        builtInProviders: {
          phone: signInSettings.builtInProviders.phone,
          web3Wallet: signInSettings.builtInProviders.web3Wallet,
        },
      },
    })
  })

  it('discards sign-in settings edits back to loaded management values', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    const passwordSignIn = await screen.findByRole('switch', { name: 'Passwordless' })
    fireEvent.click(passwordSignIn)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(passwordSignIn.getAttribute('aria-checked')).toBe('false')
    expect(requests).toEqual([])
  })

  it('discards sign-in settings optional fields back to empty defaults', async () => {
    const settings = {
      ...signInSettings,
      links: { termsUri: null, privacyUri: null, supportEmail: null },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(settings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByLabelText('Default redirect URI')).toBeNull()
    expect(screen.queryByLabelText('Default application ID')).toBeNull()
    expect(screen.queryByLabelText('Terms URL')).toBeNull()
    expect(screen.queryByLabelText('Privacy URL')).toBeNull()
    expect(screen.queryByLabelText('Support email')).toBeNull()
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
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByLabelText('Terms URL')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save sign-in settings' })).toBeNull()
    expect(requests).toEqual([])
  })

  it('renders sign-in save errors from the management boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Sign-in save failed.' } }, 500))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Passwordless' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save sign-in settings' }))

    expect(await screen.findByText('Sign-in save failed.')).toBeTruthy()
  })

  it('hides excluded sign-in method rows from runtime config', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            signIn: {
              ...signInSettings.signIn,
              passwordEnabled: false,
              emailOtpEnabled: true,
              usernameEnabled: false,
            },
          }),
        )
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByText('Email OTP')).toBeNull()
    expect(screen.queryByText('Forgot-password verification')).toBeNull()
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
    expect(screen.queryByRole('switch', { name: 'Dark mode' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: '--auth-panel-radius: 16px;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))

    expect(
      screen.getByLabelText('Northstar ID hosted sign-in preview').closest('.brandingPreview')?.getAttribute('style'),
    ).toContain('--auth-panel-radius: 16px')
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

  it('discards branding edits back to loaded branding values', async () => {
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

    const logoUrl = (await screen.findByLabelText('Logo URL')) as HTMLInputElement
    fireEvent.change(logoUrl, { target: { value: 'https://cdn.example.com/changed.svg' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: 'display: none;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(logoUrl.value).toBe('https://cdn.example.com/logo.svg')
    expect(screen.getByLabelText('Custom CSS')).toHaveProperty('value', '--auth-panel-radius: 8px;')
    expect(requests).toEqual([])
  })

  it('renders polished branding upload controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    const logoInput = await screen.findByLabelText('Upload branding logo')
    const faviconInput = screen.getByLabelText('Upload favicon')
    expect(logoInput.className).toBe('assetUploadInput')
    expect(faviconInput.className).toBe('assetUploadInput')
    expect(screen.getAllByText('Choose file')).toHaveLength(2)
    expect(document.querySelectorAll('img.assetPreview')).toHaveLength(2)
  })

  it('switches the hosted sign-in preview between desktop and mobile viewports', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    const preview = (await screen.findByLabelText('Acme Auth hosted sign-in preview')).closest('.brandingPreview')
    expect(preview?.className).not.toContain('max-w-80')

    fireEvent.click(screen.getByRole('tab', { name: 'Mobile' }))

    expect(screen.getByRole('tab', { name: 'Mobile' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Acme Auth hosted sign-in preview').closest('.brandingPreview')?.className).toContain(
      'hostedAuthPreview-mobile',
    )
  })

  it('updates the hosted sign-in preview from unsaved branding edits', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/northstar-logo.svg' },
    })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#0f766e' } })
    fireEvent.change(screen.getByLabelText('Background color'), { target: { value: '#f8fafc' } })

    const preview = screen.getByLabelText('Northstar ID hosted sign-in preview').closest('.brandingPreview')
    expect(document.querySelector('.hostedAuthPanel .brandLogo')?.getAttribute('src')).toBe(
      'https://cdn.example.com/northstar-logo.svg',
    )
    expect(preview?.getAttribute('style')).toContain('--brand-primary: #0f766e')
    expect(preview?.getAttribute('style')).toContain('--brand-background: #f8fafc')
  })

  it('falls back to a brand mark when the hosted preview logo cannot load', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/missing-logo.svg' },
    })

    const logo = document.querySelector('.hostedAuthPanel img.brandLogo')
    expect(logo?.getAttribute('src')).toBe('https://cdn.example.com/missing-logo.svg')
    fireEvent.error(logo as Element)

    await waitFor(() => expect(document.querySelector('.hostedAuthPanel img.brandLogo')).toBeNull())
    expect(document.querySelector('.hostedAuthPanel .brandMark')?.textContent).toBe('N')
  })

  it('uses runtime sign-in method settings inside branding and content previews', async () => {
    const otpOnlySettings = {
      ...signInSettings,
      signIn: {
        ...signInSettings.signIn,
        passwordEnabled: false,
        emailOtpEnabled: true,
        socialLoginEnabled: false,
        signupEnabled: false,
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(otpOnlySettings))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<BrandingPage />)

    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with identity provider' })).toBeNull()
    expect(screen.queryByText('No account yet? Create account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()

    unmount()
    renderWithQuery(<ContentSettingsPage />)

    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with identity provider' })).toBeNull()
    expect(screen.queryByText('No account yet? Create account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
  })

  it('renders hosted sign-in previews inside editable sign-in experience pages', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const previewSignInSettings = {
      ...signInSettings,
      signIn: { ...signInSettings.signIn, emailOtpEnabled: true },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(previewSignInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors')
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<SignInSettingsPage />)

    const signInPreview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(signInPreview).toBeTruthy()
    expect(signInPreview.closest('.brandingPreview')?.getAttribute('style')).toContain('--auth-panel-radius: 8px')
    expect(signInPreview.closest('.brandingPreview')?.getAttribute('style')).toContain('--brand-primary: #2563eb')
    expect(signInPreview.querySelector('img.brandLogo')?.getAttribute('src')).toBe('https://cdn.example.com/logo.svg')
    expect(screen.queryByRole('link', { name: 'Desktop' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Mobile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByText('Choose how to continue')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue with Email' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue with Phone' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(signInPreview.querySelector('button img[src="https://cdn.simpleicons.org/google"]')).toBeTruthy()
    expect(signInPreview.querySelector('.authMethodDivider')?.textContent).toBe('or')
    expect(signInPreview.querySelector('.authSignupPrompt')?.textContent).toBe('No account yet? Create account')
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Continue with Email' }))
    expect(within(signInPreview).getByRole('button', { name: /Send (code|sign-in link)/ })).toBeTruthy()
    expect(within(signInPreview).getByRole('button', { name: 'Back to sign in' })).toBeTruthy()
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Back to sign in' }))
    const previewPathBeforeSignup = window.location.pathname
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Create account' }))
    expect(window.location.pathname).toBe(previewPathBeforeSignup)
    expect(within(signInPreview).getByRole('heading', { name: 'Create account' })).toBeTruthy()
    expect(within(signInPreview).getByLabelText('Name')).toBeTruthy()
    expect(within(signInPreview).getByLabelText('Username')).toBeTruthy()
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Already have an account?' }))
    expect(screen.queryByLabelText('Headline')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Passwordless' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social login' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow sign up' }))
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByText('Choose how to continue')).toBeNull()
    expect(screen.queryByText('No account yet? Create account')).toBeNull()
    const desktopPreviewButton = screen.getByRole('button', { name: 'Open hosted sign-in' })
    fireEvent.click(desktopPreviewButton)
    expect(open).toHaveBeenCalledWith('/sign-in', '_blank', 'noopener')

    unmount()
    renderWithQuery(<ContentSettingsPage />)

    const contentPreview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(contentPreview).toBeTruthy()
    expect(contentPreview.closest('.brandingPreview')?.getAttribute('style')).toContain('--auth-panel-radius: 8px')
    expect(contentPreview.querySelector('img.brandLogo')?.getAttribute('src')).toBe('https://cdn.example.com/logo.svg')
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://example.com/terms')
    fireEvent.change(screen.getByLabelText('Sign-in message'), { target: { value: 'Content preview changed' } })
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar Content' } })
    fireEvent.change(screen.getByLabelText('Terms URL'), {
      target: { value: 'https://northstar.example.com/terms' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'content@northstar.example' } })
    expect(screen.getByRole('heading', { name: 'Content preview changed' })).toBeTruthy()
    expect(screen.getByLabelText('Northstar Content hosted sign-in preview')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://northstar.example.com/terms')
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('href')).toBe('mailto:content@northstar.example')
  })

  it('renders OneTap in hosted previews from the same sign-in method controls', async () => {
    const oneTapSettings = {
      ...signInSettings,
      signIn: { ...signInSettings.signIn, passwordEnabled: false, emailOtpEnabled: false, socialLoginEnabled: false },
      builtInProviders: {
        ...signInSettings.builtInProviders,
        oneTap: { ...signInSettings.builtInProviders.oneTap, enabled: true, clientId: 'google-client-id' },
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(oneTapSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ContentSettingsPage />)

    const signInPreview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(within(signInPreview).getByRole('button', { name: 'Continue with OneTap' })).toBeTruthy()
    expect(within(signInPreview).queryByText('No sign-in methods are enabled.')).toBeNull()
  })

  it('does not apply unsafe custom CSS to the branding preview', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Custom CSS'), { target: { value: 'display: none;' } })

    expect(
      screen.getByLabelText('Acme Auth hosted sign-in preview').closest('.brandingPreview')?.getAttribute('style'),
    ).not.toContain('display')
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

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Changed Auth' } })
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
    fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'https://cdn.example.com/changed.svg' } })
    fireEvent.change(screen.getByLabelText('Favicon URL'), {
      target: { value: 'https://cdn.example.com/changed.ico' },
    })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#0f766e' } })
    fireEvent.change(screen.getByLabelText('Background color'), { target: { value: '#f8fafc' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: '--auth-panel-radius: 16px;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.getByLabelText('Logo URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Primary color')).toHaveProperty('value', '#b42318')
    expect(screen.getByLabelText('Background color')).toHaveProperty('value', '#f7f3ee')
    expect(screen.getByLabelText('Custom CSS')).toHaveProperty('value', '')
  })

  it('renders sign-in and account configuration tabs without v1 dead-end controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/account-center-settings') {
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect((await screen.findByRole('link', { name: 'Account Center' })).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('link', { name: 'Collect user profile' })).toBeNull()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await screen.findByRole('switch', { name: 'Profile section' })
    expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Profile section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Password section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Connected accounts and apps' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Sessions section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Display name' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Username' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Avatar' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Email changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open account center' }))
    expect(openSpy).toHaveBeenCalledWith('/profile', '_blank', 'noopener')
    fireEvent.click(screen.getByRole('button', { name: 'Save account center' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/management/account-center-settings',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"sessionsViewEnabled":false'),
        }),
      ),
    )

    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            signIn: {
              ...signInSettings.signIn,
              passwordEnabled: false,
              emailOtpEnabled: true,
            },
          }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()

    cleanup()
    renderWithQuery(<ContentSettingsPage />)

    expect((await screen.findByRole('link', { name: 'Content' })).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByLabelText('Language')).toBeNull()
    expect(await screen.findByLabelText('Sign-in message')).toHaveProperty('value', 'Sign in to Acme Auth')
  })

  it('renders routed connector, account, tenant, and webhook settings tabs with active states', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/account-center-settings') {
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect((await screen.findByRole('link', { name: 'Account Center' })).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('heading', { name: 'Profile field permissions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open account center' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull()

    cleanup()
    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByRole('heading', { name: 'Connectors' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Passwordless' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Social' })).toBeNull()

    cleanup()
    renderWithQuery(<WebhooksPage section="requests" />)

    expect(screen.getByRole('link', { name: 'Requests' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Endpoints' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByLabelText('Search webhooks')).not.toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Filter webhook status')).not.toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)

    expect((await screen.findByRole('link', { name: 'OIDC configs' })).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('tab', { name: 'Private key' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Cookie key' }))
    expect(screen.getByRole('tab', { name: 'Cookie key' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByText('Cookie cache').length).toBeGreaterThan(1)
  })

  it('opens account center from the account configuration tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let accountCenterRequests = 0
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/account-center-settings') {
        accountCenterRequests += 1
        if (accountCenterRequests === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Account center unavailable.' } }, 503))
        }
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect(await screen.findByText('Account center unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open account center' }))

    expect(open).toHaveBeenCalledWith('/profile', '_blank', 'noopener')
  })

  it('manages webhook endpoint controls and request detail through the management API', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      requests.push({ url, method, body })

      if (url.startsWith('/api/management/webhooks/endpoints') && method === 'GET') {
        return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
      }
      if (url === '/api/management/webhooks/endpoints' && method === 'POST') {
        return Promise.resolve(jsonResponse({ endpoint: webhookEndpoint, signingSecret: 'whsec_created_secret' }, 201))
      }
      if (url === '/api/management/webhooks/endpoints/wh_1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...webhookEndpoint, enabled: false }))
      }
      if (url === '/api/management/webhooks/endpoints/wh_1/secrets' && method === 'POST') {
        return Promise.resolve(jsonResponse({ endpoint: webhookEndpoint, signingSecret: 'whsec_rotated_secret' }, 201))
      }
      if (url === '/api/management/webhooks/endpoints/wh_1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.startsWith('/api/management/webhooks/requests') && method === 'GET') {
        return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
      }
      if (url === '/api/management/webhooks/requests/whr_1/retries' && method === 'POST') {
        return Promise.resolve(jsonResponse({ ...webhookRequest, status: 'pending' }, 202))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<WebhooksPage />)

    expect(await screen.findByRole('heading', { name: 'Webhooks' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://events.example.com/auth' },
    })
    fireEvent.click(screen.getByLabelText('session.revoked'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Create endpoint' })[0])

    await screen.findByText('whsec_created_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }))
    expect(writeText).toHaveBeenCalledWith('whsec_created_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(requests).toContainEqual({
      url: '/api/management/webhooks/endpoints',
      method: 'POST',
      body: {
        url: 'https://events.example.com/auth',
        events: ['user.created', 'session.revoked'],
        enabled: true,
      },
    })

    fireEvent.change(screen.getByLabelText('Search webhooks'), { target: { value: 'auth' } })
    fireEvent.change(screen.getByLabelText('Filter webhook status'), { target: { value: 'enabled' } })
    await waitFor(() =>
      expect(
        requests.some((request) => request.url.includes('search=auth') && request.url.includes('status=enabled')),
      ).toBe(true),
    )

    fireEvent.click(await screen.findByRole('switch', { name: 'Enabled' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/webhooks/endpoints/wh_1',
        method: 'PATCH',
        body: { enabled: false },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    await screen.findByText('whsec_rotated_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.url === '/api/management/webhooks/endpoints/wh_1' && request.method === 'DELETE',
        ),
      ).toBe(true),
    )

    cleanup()
    renderWithQuery(<WebhooksPage section="requests" />)

    expect((await screen.findByRole('link', { name: 'Requests' })).getAttribute('aria-current')).toBe('page')
    fireEvent.change(screen.getByLabelText('Filter webhook status'), { target: { value: 'failed' } })
    await waitFor(() => expect(requests.some((request) => request.url.includes('status=failed'))).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: 'user.created' }))
    expect(await screen.findByText('Webhook request')).toBeTruthy()
    expect(screen.getByText('Server error')).toBeTruthy()
    expect(screen.getByText('Request body')).toBeTruthy()
    expect(screen.getByText('Response body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/webhooks/requests/whr_1/retries',
        method: 'POST',
        body: null,
      }),
    )
  })

  it('hides deferred audit logs and unavailable JWT controls', async () => {
    renderWithQuery(<CustomizeJwtPage />)

    expect(screen.getByRole('heading', { name: 'Custom JWT' })).toBeTruthy()
    expect(screen.queryByText(/Unavailable/i)).toBeNull()
    expect(screen.queryByText(/Arbitrary claim editor/i)).toBeNull()
    expect(screen.queryByText(/Interactive user fields/i)).toBeNull()

    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/audit-logs')

    render(<AppRouter />)

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Audit logs' })).toBeNull())
    expect(screen.queryByLabelText('Search audit logs')).toBeNull()
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

  it('discards content edits back to loaded hosted auth copy', async () => {
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

    const productName = (await screen.findByLabelText('Product name')) as HTMLInputElement
    fireEvent.change(productName, { target: { value: 'Changed product' } })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'changed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(productName.value).toBe('Acme Auth')
    expect(screen.getByLabelText('Support email')).toHaveProperty('value', 'support@example.com')
    expect(requests).toEqual([])
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

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Changed Auth' } })
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
    fireEvent.change(screen.getByLabelText('Terms URL'), { target: { value: 'https://changed.example.com/terms' } })
    fireEvent.change(screen.getByLabelText('Privacy URL'), {
      target: { value: 'https://changed.example.com/privacy' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'changed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.getByLabelText('Terms URL')).toHaveProperty('value', '')
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
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe('true')
    expect(summaryCard('Organization summary').getByText('org-1')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('acme')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Acme Inc.')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Enabled')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('tab', { name: 'Authorization' }))
    expect(screen.getAllByText('Organization ID').length).toBeGreaterThan(0)
    expect(screen.getByText('Members and invitations')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Not set')).toBeTruthy()
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

    fireEvent.click(screen.getByRole('link', { name: 'Organization permissions' }))
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
    expect(summaryCard('Resource summary').getByText('resource-1')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('management-api')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('https://auth.example.com/api/management')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('Enabled')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1',
        method: 'PATCH',
        body: { enabled: false },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Scopes' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'orders:write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create scope' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/scopes',
        method: 'POST',
        body: { value: 'orders:write' },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Permissions' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'orders.write' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create permission' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/api-resources/resource-1/permissions',
        method: 'POST',
        body: { key: 'orders.write' },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Scopes' }))
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
    fireEvent.click(screen.getByRole('tab', { name: 'Permissions' }))
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
    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('role-1')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('admin')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('API resource resource-1')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('orders.read')).toBeTruthy())
    expect(summaryCard('Role summary').getByText('Permissions')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('0')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/roles/role-1/permissions',
        method: 'PUT',
        body: { permissionIds: ['permission-1'] },
      }),
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Assignments' }))
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: adminAccountProfile }))
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

    const { unmount } = renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="scopes" />)

    expect(await screen.findByText('No scopes yet.')).toBeTruthy()

    fireEvent.submit(screen.getByRole('button', { name: 'Create scope' }).closest('form')!)

    expect(await screen.findByText('Invalid input: expected string, received undefined')).toBeTruthy()
    unmount()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" section="permissions" />)

    expect(await screen.findByText('No permissions yet.')).toBeTruthy()
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

  it('retries organization and organization-template detail loading failures', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/organizations/org-1') {
        return Promise.resolve(jsonResponse({ error: 'Organization unavailable.' }, 503))
      }
      if (url === '/api/management/roles') return Promise.resolve(jsonResponse({ error: 'Roles unavailable.' }, 503))
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)

    expect(await screen.findByText('Organization unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/organizations/org-1').length).toBe(2))

    unmount()
    renderWithQuery(<OrganizationTemplatePage />)

    expect(await screen.findByText('Roles unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/roles').length).toBe(2))
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

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

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

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

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

    renderWithQuery(<RoleDetailPage roleId="role-1" section="permissions" />)

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

  it('renders detail summary variants for unset and scoped records', async () => {
    let roleDetail = {
      ...role,
      applicationId: 'app-1' as string | null,
      organizationId: null as string | null,
      resourceId: null as string | null,
      system: false,
      tokenClaimName: 'roles' as string | null,
      tokenClaimValue: 'admin' as string | null,
    }
    const disabledOrganization = {
      ...organization,
      displayName: null,
      disabled: true,
      disabledReason: 'Paused by policy',
    }
    const disabledResource = {
      ...apiResource,
      enabled: false,
      tokenClaimsNamespace: 'https://claims.example.com',
    }

    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/users/user-1') {
        return Promise.resolve(
          jsonResponse({
            user: {
              id: 'user-1',
              email: null,
              emailVerified: false,
              username: null,
              role: null,
              banned: true,
              banReason: 'abuse',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          }),
        )
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
      if (url === '/api/management/users/user-1/security')
        return Promise.resolve(jsonResponse({ security: adminSecurity }))
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/organizations/org-1') return Promise.resolve(jsonResponse(disabledOrganization))
      if (url === '/api/management/roles/role-1') return Promise.resolve(jsonResponse(roleDetail))
      if (url === '/api/management/roles/role-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [apiPermission] }))
      }
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(disabledResource))
      if (url === '/api/management/api-resources/resource-1/scopes') {
        return Promise.resolve(jsonResponse({ scopes: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/api-resources/resource-1/permissions') {
        return Promise.resolve(jsonResponse({ permissions: [], pagination: emptyPagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<UserDetailPage userId="user-1" />)

    expect(await screen.findByRole('heading', { name: 'user-1' })).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('Not set')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('user')).toBeTruthy()
    expect(summaryCard('Identity summary').getByText('Banned')).toBeTruthy()
    expect(summaryCard('Identity summary').getAllByText('0').length).toBeGreaterThanOrEqual(3)

    cleanup()
    renderWithQuery(<OrganizationDetailPage organizationId="org-1" />)

    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Acme')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Disabled')).toBeTruthy()
    expect(summaryCard('Organization summary').getByText('Paused by policy')).toBeTruthy()

    cleanup()
    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('Disabled')).toBeTruthy()
    expect(summaryCard('Resource summary').getByText('https://claims.example.com')).toBeTruthy()

    cleanup()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('Application app-1')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('1')).toBeTruthy()
    expect(summaryCard('Role summary').getByText('roles')).toBeTruthy()

    cleanup()
    roleDetail = { ...role, organizationId: 'org-1', resourceId: null, system: false }
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('Organization org-1')).toBeTruthy()

    cleanup()
    roleDetail = { ...role, applicationId: null, organizationId: null, resourceId: null }
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('Tenant')).toBeTruthy()
  })

  it('renders detail summary counts while related detail lists are loading', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/api-resources/resource-1') return Promise.resolve(jsonResponse(apiResource))
      if (url === '/api/management/api-resources/resource-1/scopes') return new Promise(() => undefined)
      if (url === '/api/management/api-resources/resource-1/permissions') return new Promise(() => undefined)
      if (url === '/api/management/users/user-1') return Promise.resolve(jsonResponse({ user }))
      if (url.startsWith('/api/management/users/user-1/sessions')) return new Promise(() => undefined)
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) return new Promise(() => undefined)
      if (url.startsWith('/api/management/users/user-1/applications')) return new Promise(() => undefined)
      if (url === '/api/management/users/user-1/security') return new Promise(() => undefined)
      if (url.startsWith('/api/management/users/user-1/passkeys')) return new Promise(() => undefined)
      if (url === '/api/management/roles/role-1') {
        return Promise.resolve(jsonResponse({ ...role, resourceId: 'resource-1' }))
      }
      if (url === '/api/management/roles/role-1/permissions') return new Promise(() => undefined)
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApiResourceDetailPage resourceId="resource-1" />)

    expect(await screen.findByRole('heading', { name: 'Management API' })).toBeTruthy()
    expect(summaryCard('Resource summary').getAllByText('0')).toHaveLength(2)

    cleanup()
    renderWithQuery(<RoleDetailPage roleId="role-1" />)

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeTruthy()
    expect(summaryCard('Role summary').getByText('0')).toBeTruthy()

    cleanup()
    renderWithQuery(<UserDetailPage userId="user-1" />)

    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeTruthy()
    expect(summaryCard('Identity summary').getAllByText('0')).toHaveLength(3)
  })

  it('renders admin variants for empty, disabled, and unset states', async () => {
    const disabledApplication = { ...application, disabled: true, trusted: false }
    const idOnlyUser = { ...user, email: null, name: null, role: ['admin', 'viewer'] }
    const defaultConnector = { ...connector, enabled: false, scopes: [] }
    const unsetSignInSettings = {
      ...signInSettings,
      signIn: { ...signInSettings.signIn, passwordEnabled: false },
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
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
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

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Daily active users')).toBeTruthy()
    expect(screen.getAllByText('Pending')).toHaveLength(4)

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
    expect(await screen.findByText('Google')).toBeTruthy()

    cleanup()
    renderWithQuery(<SignInSettingsPage />)
    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByLabelText('Product name')).toBeNull()

    cleanup()
    renderWithQuery(<MfaPage />)
    expect(await screen.findByText('Authenticator app')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Passkeys' }).getAttribute('aria-checked')).toBe('false')

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
    expect(await screen.findByText('Email')).toBeTruthy()
    expect(screen.getByText('Phone (SMS)')).toBeTruthy()
    expect(screen.getByRole('table')).toBeTruthy()

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

  it('renders page-specific resource actions and list toolbars', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
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
      return Promise.resolve(jsonResponse({}))
    })

    const pages = [
      {
        action: 'New application',
        component: <ApplicationsPage />,
        heading: 'Applications',
        searchLabel: 'Search applications',
      },
      { action: 'New user', component: <UsersPage />, heading: 'Users', searchLabel: 'Search users' },
      { action: null, component: <ConnectorsPage />, heading: 'Connectors', searchLabel: null },
      {
        action: 'New organization',
        component: <OrganizationsPage />,
        heading: 'Organizations',
        searchLabel: 'Search organizations',
      },
      { action: 'New role', component: <RolesPage />, heading: 'Roles', searchLabel: 'Search roles' },
      {
        action: 'New resource',
        component: <ApiResourcesPage />,
        heading: 'API resources',
        searchLabel: 'Search API resources',
      },
      { action: 'Create endpoint', component: <WebhooksPage />, heading: 'Webhooks', searchLabel: 'Search webhooks' },
    ]

    for (const page of pages) {
      renderWithQuery(page.component)

      expect(await screen.findByRole('heading', { name: page.heading })).toBeTruthy()
      if (page.searchLabel) expect(await screen.findByLabelText(page.searchLabel)).toBeTruthy()
      if (page.action) expect(screen.getAllByRole('button', { name: page.action }).length).toBeGreaterThan(0)

      cleanup()
      queryClient.clear()
    }
  })

  it('filters changed admin resource lists and shows filter-specific empty states', async () => {
    const githubConnector = {
      ...connector,
      id: 'connector-2',
      slug: 'github-oauth',
      displayName: 'GitHub',
      providerId: 'github',
    }
    const northwindOrganization = {
      ...organization,
      id: 'org-2',
      slug: 'northwind',
      name: 'Northwind',
      displayName: 'Northwind Traders',
    }
    const billingManagerRole = {
      ...role,
      id: 'role-2',
      key: 'billing-manager',
      name: 'Billing manager',
      description: 'Controls invoices',
      system: false,
      organizationId: 'org-1',
    }
    const ordersReaderRole = {
      ...role,
      id: 'role-3',
      key: 'orders-reader',
      name: 'Orders reader',
      description: 'Reads orders',
      system: false,
      resourceId: 'resource-1',
    }
    const billingResource = {
      ...apiResource,
      id: 'resource-2',
      identifier: 'billing-api',
      name: 'Billing API',
      audience: 'https://billing.example.com',
    }

    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector, githubConnector], pagination }))
      }
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization, northwindOrganization], pagination }))
      }
      if (url === '/api/management/roles') {
        return Promise.resolve(jsonResponse({ roles: [role, billingManagerRole, ordersReaderRole], pagination }))
      }
      if (url === '/api/management/api-resources') {
        return Promise.resolve(jsonResponse({ resources: [apiResource, billingResource], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    const { unmount } = renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Email')).toBeTruthy()
    expect(screen.getByText('Phone (SMS)')).toBeTruthy()
    expect(await screen.findByText('Google')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()

    unmount()
    renderWithQuery(<OrganizationsPage />)

    expect(await screen.findByText('Acme')).toBeTruthy()
    expect(screen.getByText('Northwind')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'north' } })
    await waitFor(() => {
      expect(screen.getByText('Northwind')).toBeTruthy()
      expect(screen.queryByText('Acme')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'missing' } })
    expect(await screen.findByText('No organizations found')).toBeTruthy()
    expect(screen.getByText('No organizations match the current search.')).toBeTruthy()

    cleanup()
    queryClient.clear()
    renderWithQuery(<RolesPage />)

    expect(await screen.findByText('Admin')).toBeTruthy()
    expect(screen.getByText('Billing manager')).toBeTruthy()
    expect(screen.getByText('Orders reader')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search roles'), { target: { value: 'billing' } })
    await waitFor(() => {
      expect(screen.getByText('Billing manager')).toBeTruthy()
      expect(screen.queryByText('Admin')).toBeNull()
      expect(screen.queryByText('Orders reader')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('Search roles'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter role scope'), { target: { value: 'resource' } })
    await waitFor(() => {
      expect(screen.getByText('Orders reader')).toBeTruthy()
      expect(screen.queryByText('Admin')).toBeNull()
      expect(screen.queryByText('Billing manager')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('Filter role scope'), { target: { value: 'application' } })
    expect(await screen.findByText('No roles found')).toBeTruthy()
    expect(screen.getByText('No roles match the current search or scope filter.')).toBeTruthy()

    cleanup()
    queryClient.clear()
    renderWithQuery(<ApiResourcesPage />)

    expect(await screen.findByText('Management API')).toBeTruthy()
    expect(screen.getByText('Billing API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search API resources'), { target: { value: 'billing' } })
    await waitFor(() => {
      expect(screen.getByText('Billing API')).toBeTruthy()
      expect(screen.queryByText('Management API')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('Search API resources'), { target: { value: 'missing' } })
    expect(await screen.findByText('No API resources found')).toBeTruthy()
    expect(screen.getByText('No API resources match the current search.')).toBeTruthy()
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
        text: 'Sign-up and sign-in',
      },
      {
        component: <ContentSettingsPage />,
        matches: (url: string) => url === '/api/management/sign-in-settings',
        success: signInSettings,
        text: 'Hosted messages',
      },
      {
        component: <BrandingPage />,
        matches: (url: string) => url === '/api/management/branding-settings',
        success: brandingSettings,
        text: 'Live preview',
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
        if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
        if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
        return Promise.resolve(jsonResponse({}))
      })

      renderWithQuery(scenario.component)

      expect(await screen.findByText('Temporary unavailable.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect((await screen.findAllByText(scenario.text)).length).toBeGreaterThan(0)

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
    expect(screen.getByText('Live preview')).toBeTruthy()

    unmount()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
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
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(application))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="branding" />)
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
    expect(screen.getByRole('button', { name: /Single-page app/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Native app/ }))
    expect(screen.getByRole('button', { name: /Native app/ }).getAttribute('aria-pressed')).toBe('true')
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
            clientType: 'public_native',
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

function metricValue(label: string) {
  const card = screen.getByText(label).closest('[data-ui="card"]')
  expect(card).toBeTruthy()
  return card?.querySelector('.text-2xl')?.textContent ?? ''
}

function summaryCard(title: string) {
  const card = screen.getByRole('heading', { name: title }).closest('[data-ui="card"]')
  expect(card).toBeTruthy()
  return within(card as HTMLElement)
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
  if (url === '/api/account/agents') return Promise.resolve(jsonResponse({ agents: [], pagination: emptyPagination }))
  if (url === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
  if (url === '/api/account/security') return Promise.resolve(jsonResponse({ security: accountSecurity }))
  if (url === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
  return Promise.resolve(jsonResponse(init?.method ? { ok: true } : {}))
}

function consoleRouteFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
  if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
  if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/management/account-center-settings') return Promise.resolve(jsonResponse(accountCenterSettings))
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
  if (url.startsWith('/api/management/webhooks/endpoints')) {
    return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
  }
  if (url.startsWith('/api/management/webhooks/requests')) {
    return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
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

const webhookEndpoint = {
  id: 'wh_1',
  url: 'https://app.example.com/webhooks/auth',
  events: ['user.created', 'session.revoked'],
  enabled: true,
  secretPrefix: 'whsec_abcd123',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const webhookRequest = {
  id: 'whr_1',
  endpointId: 'wh_1',
  endpointUrl: 'https://app.example.com/webhooks/auth',
  event: 'user.created',
  status: 'failed',
  attemptCount: 1,
  httpStatus: 500,
  error: 'Server error',
  requestBody: '{"id":"user-1"}',
  responseBody: '{"error":"failed"}',
  nextAttemptAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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
  systemManaged: false,
  disabled: false,
  disabledReason: null,
  redirectUris: ['https://app.example.com/callback'],
  postLogoutRedirectUris: ['https://app.example.com/signed-out'],
  corsOrigins: ['https://app.example.com'],
  customData: { plan: 'enterprise' },
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
  oidcClaims: {
    accessToken: {
      authorization: true,
      roles: true,
      permissions: true,
    },
    idToken: {},
    userInfo: {},
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

const adminAccountProfile = {
  ...profile,
  role: 'admin',
}

const connector = {
  id: 'connector-1',
  providerId: 'google',
  providerType: 'social',
  slug: 'google',
  displayName: 'Google',
  enabled: true,
  clientId: 'google-client',
  clientSecretConfigured: true,
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
      requiredFields: ['clientId', 'clientSecret'],
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
      providerType: 'social',
      providerId: 'cognito',
      displayName: 'Amazon Cognito',
      icon: 'cognito',
      requiredFields: [
        'clientId',
        'clientSecret',
        'providerMetadata.domain',
        'providerMetadata.region',
        'providerMetadata.userPoolId',
      ],
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
      providerType: 'social',
      providerId: 'github',
      displayName: 'GitHub',
      icon: 'github',
      requiredFields: ['clientId', 'clientSecret'],
      optionalFields: ['scopes'],
      defaultScopes: ['read:user', 'user:email'],
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
      requiredFields: ['clientId', 'clientSecret', 'issuer or authorizationEndpoint + tokenEndpoint'],
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
    emailOtpEnabled: false,
    socialLoginEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
  },
  builtInProviders: {
    email: {
      enabled: true,
      otpLength: 6,
      expiresInSeconds: 300,
    },
    phone: {
      enabled: false,
      smsProvider: 'twilio',
      otpLength: 6,
      expiresInSeconds: 300,
      signUpOnVerification: false,
      requireVerification: true,
      twilioAccountSid: '',
      twilioAuthToken: '',
      twilioFromNumber: '',
      vonageApiKey: '',
      vonageApiSecret: '',
      vonageFrom: '',
      messageBirdAccessKey: '',
      messageBirdOriginator: '',
    },
    web3Wallet: {
      enabled: false,
      chains: [1],
      domain: '',
      emailDomainName: '',
      allowSignUp: true,
      ensLookupEnabled: false,
    },
    passkey: {
      allowSignUp: true,
    },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
      disableSignUp: false,
    },
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

const accountCenterSettings = {
  accountCenter: {
    profileEditingEnabled: true,
    displayNameEditable: true,
    usernameEditable: true,
    avatarEditable: true,
    emailChangeEnabled: true,
    passwordChangeEnabled: true,
    connectedAccountsEnabled: true,
    sessionsViewEnabled: true,
    dangerZoneEnabled: false,
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
    password: {
      minLength: 12,
      requiredCharacterTypes: 2,
      customWords: [],
      rejectUserInfo: true,
      rejectSequential: true,
      rejectCustomWords: false,
    },
    captcha: {
      enabled: false,
      provider: 'turnstile',
      siteKey: '',
      secretBinding: '',
    },
    blocklist: {
      blockSubaddressing: false,
      entries: [],
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
      description: 'Email binding and sender settings are needed for verification, OTP, and reset flows.',
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
    emailOtpEnabled: true,
    usernameEnabled: false,
    identifierFirst: false,
  },
  builtInProviders: {
    email: { enabled: true },
    phone: { enabled: false },
    web3Wallet: { enabled: false, chains: [1], allowSignUp: true },
    passkey: { allowSignUp: true },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
    },
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
  accountCenter: accountCenterSettings.accountCenter,
}
