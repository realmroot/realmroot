import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { ApplicationsPage } from '@/features/console/extracted/applications/applications-list'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { DeploymentSettingsPage } from '@/features/console/extracted/deployment-misc/deployment'
import { WebhooksPage } from '@/features/console/extracted/deployment-misc/webhooks'
import { ConsoleOnboardingPage } from '@/features/console/extracted/onboarding'
import { OrganizationsPage } from '@/features/console/extracted/organizations'
import { RolesPage } from '@/features/console/extracted/roles'
import { MfaPage } from '@/features/console/extracted/security-settings'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
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
  apiResource,
  application,
  brandingSettings,
  connector,
  connectorTemplates,
  consoleSharedFetch,
  jsonResponse,
  organization,
  pagination,
  readinessIncomplete,
  renderWithQuery,
  role,
  securityPolicy,
  signInSettings,
  user,
} from './console.test-utils'

describe('console collections', () => {
  it('renders page-specific resource actions and list toolbars', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
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

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
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
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return new Promise(() => undefined)
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<ApplicationsPage />)
    expect(await screen.findByText('Loading applications')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()

    unmount()
    vi.restoreAllMocks()
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ error: { message: 'Users unavailable.' } }, 503))
      }
      return consoleSharedFetch(input, init)
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
        component: <ConsoleOnboardingPage />,
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
      vi.spyOn(window, 'fetch').mockImplementation((input, _init) => {
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
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
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
})
