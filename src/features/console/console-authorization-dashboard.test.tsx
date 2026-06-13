import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { ApplicationsPage } from '@/features/console/extracted/applications/applications-list'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { OrganizationsPage } from '@/features/console/extracted/organizations'
import { RolesPage } from '@/features/console/extracted/roles'
import { MfaPage } from '@/features/console/extracted/security-settings'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
import { UsersPage } from '@/features/console/extracted/users/users-list'
import { ConsoleDashboardPage } from '@/features/console/pages/dashboard-page'
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
  emptyPagination,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
  securityPolicy,
  signInSettings,
  user,
} from './console.test-utils'

const deviceCodeGrantType = 'urn:ietf:params:oauth:grant-type:device_code'

describe('console authorization dashboard', () => {
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
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleDashboardPage />)

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
      return consoleSharedFetch(input, init)
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

  it('creates native applications with device login enabled from the applications page', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications' && init?.method === 'POST') {
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
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
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

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/applications',
          body: {
            name: 'Runner CLI',
            slug: 'runner-cli',
            clientType: 'public_native',
            firstParty: true,
            allowedGrantTypes: ['authorization_code', 'refresh_token', deviceCodeGrantType],
            redirectUris: ['com.example.runner:/callback'],
          },
        },
      ])
    })
  })
})
