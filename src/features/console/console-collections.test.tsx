import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationsPage } from '@/features/applications/management/applications-list'
import { ExperiencePage } from '@/features/console/extracted/branding-content/branding'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { DeploymentSettingsPage, SettingsPage } from '@/features/console/extracted/deployment-misc/deployment'
import { OrganizationsPage } from '@/features/console/extracted/organizations'
import { SecurityPoliciesPage } from '@/features/console/extracted/security-settings'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
import { UsersPage } from '@/features/console/extracted/users/users-list'
import { ApiResourcesPage } from '@/features/resource-servers/management-resource-servers'
import { RolesPage } from '@/features/roles/management-roles'
import { WebhooksPage } from '@/features/webhooks/management-webhooks'
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
  emailSettings,
  generalSettings,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
  securityPolicy,
  signInSettings,
  user,
} from './console.test-utils'

describe('console collections', () => {
  const organizationRolesPage = <RolesPage organizationId="org-1" />

  it('renders page-specific resource actions and list toolbars', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ items: [application], pagination }))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ items: [user], pagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [connector], pagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      if (url === '/api/organizations/org-1/roles') return Promise.resolve(jsonResponse({ items: [role], pagination }))
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [{ ...apiResource, authorization: null }], pagination }))
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
      { action: null, component: <ConnectorsPage />, heading: 'Identity providers', searchLabel: null },
      {
        action: 'Provision organization',
        component: <OrganizationsPage />,
        heading: 'Organizations',
        searchLabel: 'Search organizations',
      },
      { action: 'New role', component: organizationRolesPage, heading: 'Roles', searchLabel: null },
      {
        action: 'New resource server',
        component: <ApiResourcesPage />,
        heading: 'Resource servers',
        searchLabel: 'Search resource servers',
      },
      { action: 'Create endpoint', component: <WebhooksPage />, heading: 'Webhooks', searchLabel: null },
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

  it('keeps invalid webhook URLs inside the create dialog without issuing a request [spec: admin-console/admin-webhook-endpoint-lifecycle]', async () => {
    const requests: Array<{ method: string; url: string }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push({ method: init?.method ?? 'GET', url })
      if (url.startsWith('/api/webhooks')) {
        return Promise.resolve(jsonResponse({ items: [], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<WebhooksPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create endpoint' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Endpoint URL' }), {
      target: { value: 'http://example.com/hooks' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create endpoint' }))

    expect(await screen.findByText('Endpoint URL must use https.')).toBeTruthy()
    expect(requests.filter((request) => request.method === 'POST')).toEqual([])
  })

  it('filters changed admin resource lists and shows filter-specific empty states [spec: admin-console/admin-authorization-inventory]', async () => {
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
      key: 'billing-manager',
      displayName: 'Billing manager',
      description: 'Controls invoices',
      predefined: false,
    }
    const ordersReaderRole = {
      ...role,
      key: 'orders-reader',
      displayName: 'Orders reader',
      description: 'Reads orders',
      predefined: false,
    }
    const billingResource = {
      ...apiResource,
      id: 'resource-2',
      identifier: 'billing-api',
      name: 'Billing API',
      resourceUrl: 'https://billing.example.com',
    }

    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [connector, githubConnector], pagination }))
      }
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization, northwindOrganization], pagination }))
      }
      if (url === '/api/organizations/org-1/roles') {
        return Promise.resolve(jsonResponse({ items: [role, billingManagerRole, ordersReaderRole], pagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(
          jsonResponse({
            items: [
              { ...apiResource, authorization: null },
              { ...billingResource, authorization: null },
            ],
            pagination,
          }),
        )
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

    expect(await screen.findByText('Acme Inc.')).toBeTruthy()
    expect(screen.getByText('Northwind Traders')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'north' } })
    await waitFor(() => {
      expect(screen.getByText('Northwind Traders')).toBeTruthy()
      expect(screen.queryByText('Acme Inc.')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'missing' } })
    expect(await screen.findByText('No organizations found')).toBeTruthy()
    expect(screen.getByText('No organizations match the current search.')).toBeTruthy()

    cleanup()
    queryClient.clear()
    renderWithQuery(organizationRolesPage)

    expect(await screen.findByText('Admin')).toBeTruthy()
    expect(screen.getByText('Billing manager')).toBeTruthy()
    expect(screen.getByText('Orders reader')).toBeTruthy()
    cleanup()
    queryClient.clear()
    renderWithQuery(<ApiResourcesPage />)

    expect(await screen.findByText('Management API')).toBeTruthy()
    expect(screen.getByText('Billing API')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search resource servers'), { target: { value: 'billing' } })
    await waitFor(() => {
      expect(screen.getByText('Billing API')).toBeTruthy()
      expect(screen.queryByText('Management API')).toBeNull()
    })
    fireEvent.change(screen.getByLabelText('Search resource servers'), { target: { value: 'missing' } })
    expect(await screen.findByText('No resource servers found')).toBeTruthy()
    expect(screen.getByText('No resource servers match the current filters.')).toBeTruthy()
  })

  it('renders canonical Organization inventory counts, fallbacks, and dialog cancellation', async () => {
    const secondOrganization = {
      ...organization,
      id: 'org-2',
      slug: 'beta',
      name: 'Beta',
      displayName: 'Beta Company',
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      if (url === '/api/organizations') {
        return Promise.resolve(
          jsonResponse({
            items: [{ ...organization, displayName: null }, secondOrganization],
            pagination,
          }),
        )
      }
      if (url === '/api/agents') {
        return Promise.resolve(
          jsonResponse({
            items: [
              { id: 'agent-1', homeSpace: { type: 'organization', organizationId: 'org-1' } },
              { id: 'agent-2', homeSpace: { type: 'organization', organizationId: 'org-2' } },
              { id: 'agent-personal', homeSpace: { type: 'personal', userId: 'user-1' } },
            ],
            pagination,
          }),
        )
      }
      if (url === '/api/organizations/org-1/members') {
        return Promise.resolve(
          jsonResponse({
            members: [{ id: 'member-1' }, { id: 'member-2' }],
            pagination: { ...pagination, total: 2 },
          }),
        )
      }
      if (url === '/api/organizations/org-2/members') {
        return Promise.resolve(jsonResponse({ error: { message: 'Members unavailable.' } }, 503))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<OrganizationsPage />)

    const acmeRow = (await screen.findByText('Acme')).closest('tr')
    expect(acmeRow).toBeTruthy()
    expect(await within(acmeRow!).findByText('2')).toBeTruthy()
    expect(within(acmeRow!).getByText('1')).toBeTruthy()

    const betaRow = screen.getByText('Beta Company').closest('tr')
    expect(betaRow).toBeTruthy()
    expect(await within(betaRow!).findByText('Unavailable')).toBeTruthy()
    expect(within(betaRow!).getByText('1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Provision organization' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('renders collection loading and query error states', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
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
      if (url.startsWith('/api/users')) {
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
        matches: (url: string) => url === '/api/applications',
        success: { items: [application], pagination },
        text: 'Customer portal',
      },
      {
        component: <ConnectorsPage />,
        matches: (url: string) => url === '/api/connectors',
        success: { items: [connector], pagination },
        text: 'Google',
      },
      {
        component: <SignInSettingsPage />,
        matches: (url: string) => url === '/api/realm/sign-in-policy',
        success: signInSettings,
        text: 'Registration and identifiers',
      },
      {
        component: <ContentSettingsPage />,
        matches: (url: string) => url === '/api/realm/sign-in-policy',
        success: signInSettings,
        text: 'Legal & support',
      },
      {
        component: <ExperiencePage section="theme" />,
        matches: (url: string) => url === '/api/realm/branding',
        success: brandingSettings,
        text: 'Color scheme',
      },
      {
        component: <SecurityPoliciesPage section="mfa" />,
        matches: (url: string) => url === '/api/realm/security-policy',
        success: securityPolicy,
        text: 'Available factors',
      },
      {
        component: <OrganizationsPage />,
        matches: (url: string) => url === '/api/organizations',
        success: { items: [organization], pagination },
        text: 'Acme Inc.',
      },
      {
        component: organizationRolesPage,
        matches: (url: string) => url === '/api/organizations/org-1/roles',
        success: { items: [role], pagination },
        text: 'Admin',
      },
      {
        component: <ApiResourcesPage />,
        matches: (url: string) => url === '/api/resource-servers',
        success: { items: [{ ...apiResource, authorization: null }], pagination },
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
        if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
        if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
        return consoleSharedFetch(input, _init)
      })

      renderWithQuery(scenario.component)

      expect(await screen.findByText('Temporary unavailable.')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect((await screen.findAllByText(scenario.text)).length).toBeGreaterThan(0)

      cleanup()
      vi.restoreAllMocks()
    }
  })

  it('renders editable branding and tenant settings pages [spec: admin-console/admin-deployment-settings]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/realm/security-policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })
    const { unmount } = renderWithQuery(<ExperiencePage section="theme" />)

    expect(await screen.findByRole('heading', { name: 'Experience' })).toBeTruthy()
    expect(await screen.findByRole('tab', { name: 'Color scheme' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()

    unmount()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(await screen.findByText('Cloudflare Workers')).toBeTruthy()
    expect(screen.getByText('Cloudflare D1')).toBeTruthy()
  })

  it('persists Realm identity from the inline General settings form [spec: admin-console/admin-general-settings]', async () => {
    let stored = generalSettings
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin).pathname
      if (url === '/api/realm') {
        if ((request?.method ?? init?.method) === 'PATCH') {
          const body = (request ? await request.clone().json() : JSON.parse(String(init?.body))) as {
            name: string
          }
          stored = { ...stored, name: body.name }
        }
        return jsonResponse(stored, 200, { ETag: '"realm-v1"' })
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="general" />)
    expect(await screen.findByText('https://auth.example.com/api/auth')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Realm name'), { target: { value: 'Acme Identity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(stored.name).toBe('Acme Identity'))
    expect(screen.getByLabelText('Realm name')).toHaveProperty('value', 'Acme Identity')
  })

  it('persists the Cloudflare sender and reply-to identity [spec: admin-console/admin-email-delivery-settings]', async () => {
    let stored = emailSettings
    vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
      const request = input instanceof Request ? input : null
      const url = new URL(request?.url ?? String(input), window.location.origin).pathname
      if (url === '/api/realm/email-delivery-configuration') {
        if ((request?.method ?? init?.method) === 'PUT') {
          const body = (request ? await request.clone().json() : JSON.parse(String(init?.body))) as typeof emailSettings
          stored = { ...stored, ...body, source: 'database' }
        }
        return jsonResponse(stored, 200, { ETag: '"email-delivery-v1"' })
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SettingsPage section="email" />)
    expect(await screen.findByLabelText('Sender name')).toHaveProperty('value', 'Realmroot')
    fireEvent.click(screen.getByRole('switch', { name: 'Email delivery' }))
    expect(screen.getByRole('switch', { name: 'Email delivery' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Email delivery' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(screen.getByLabelText('Sender name'), { target: { value: 'Acme Identity' } })
    fireEvent.change(screen.getByLabelText('Sender address'), { target: { value: 'auth@example.com' } })
    fireEvent.change(screen.getByLabelText('Reply-to address'), { target: { value: 'support@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(stored.fromName).toBe('Acme Identity'))
    expect(screen.getByLabelText('Sender address')).toHaveProperty('value', 'auth@example.com')
    expect(screen.getByLabelText('Reply-to address')).toHaveProperty('value', 'support@example.com')
  })
})
