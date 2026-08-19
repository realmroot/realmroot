import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationsPage } from '@/features/applications/management/applications-list'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { OrganizationsPage } from '@/features/console/extracted/organizations'
import { UsersPage } from '@/features/console/extracted/users/users-list'
import { ConsoleDashboardPage } from '@/features/console/pages/dashboard-page'
import { ApiResourcesPage } from '@/features/resource-servers/management-resource-servers'
import { RolesPage } from '@/features/roles/management-roles'
import { queryClient } from '@/router'
import {
  apiResource,
  application,
  connector,
  connectorTemplates,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  securityPolicy,
  signInSettings,
  user,
} from './console.test-utils'

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

const deviceCodeGrantType = 'urn:ietf:params:oauth:grant-type:device_code'

describe('console authorization dashboard', () => {
  it('derives inventory and Realm readiness from current management configuration', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ items: [{ ...application, disabled: true }], pagination }))
      }
      if (/^\/api\/users(?:\?|$)/.test(url)) return Promise.resolve(jsonResponse({ items: [user], pagination }))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [{ ...connector, enabled: false }], pagination }))
      }
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [organization], pagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [apiResource], pagination }))
      }
      if (url === '/api/realm/sign-in-policy') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            signIn: { ...signInSettings.signIn, passwordEnabled: false },
          }),
        )
      }
      if (url === '/api/realm/security-policy') {
        return Promise.resolve(
          jsonResponse({
            policy: {
              ...securityPolicy.policy,
              passkeys: { ...securityPolicy.policy.passkeys, enabled: false },
            },
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Realm readiness')).toBeTruthy()
    expect(screen.getByText('Configuration gaps')).toBeTruthy()
    expect(screen.getByText('Not available')).toBeTruthy()
    expect(screen.getByText('Applications').closest('[data-slot="card"]')?.textContent).toContain('1')
    expect(screen.queryByText('Daily active users')).toBeNull()
  })

  it('renders current empty states and create entry points for management collections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (/^\/api\/users(?:\?|$)/.test(url)) {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/organizations') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/organizations/org-1/roles') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      if (url === '/api/resource-servers') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)
    expect(await screen.findByText('No applications yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    expect(await screen.findByRole('heading', { name: 'Create application' })).toBeTruthy()

    cleanup()
    renderWithQuery(<UsersPage />)
    expect(await screen.findByText('No users yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New user' })).toBeTruthy()

    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByText('Email')).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'OIDC connectors' }), { button: 0, ctrlKey: false })
    expect(await screen.findByText('No OIDC connectors yet')).toBeTruthy()

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    expect(await screen.findByText('No organizations yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Provision organization' })).toBeTruthy()

    cleanup()
    renderWithQuery(<RolesPage organizationId="org-1" />)
    expect(await screen.findByText('No Roles')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New role' })).toBeTruthy()

    cleanup()
    renderWithQuery(<ApiResourcesPage />)
    expect(await screen.findByText('No resource servers yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New resource server' })).toBeTruthy()
  })

  it('creates native applications with derived device login from the applications page [spec: admin-console/admin-create-application]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          jsonResponse(
            {
              ...application,
              id: 'app-device',
              name: 'Runner CLI',
              slug: 'runner-cli',
              clientType: 'public_native',
              allowedGrantTypes: ['authorization_code', 'refresh_token', deviceCodeGrantType],
            },
            201,
          ),
        )
      }
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ items: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'New application' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Runner CLI' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'runner-cli' } })
    fireEvent.click(screen.getByRole('button', { name: /Native app/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'Device login' }))
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'com.example.runner:/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/applications',
          body: {
            name: 'Runner CLI',
            slug: 'runner-cli',
            clientType: 'public_native',
            deviceLoginEnabled: true,
            ownerOrganizationId: 'org-1',
            redirectUris: ['com.example.runner:/callback'],
            visibility: 'private',
          },
        },
      ]),
    )
  })
})
