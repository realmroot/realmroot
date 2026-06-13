import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'
import { OrganizationTemplatePage } from '@/features/console/extracted/deployment-misc/misc'
import { OrganizationDetailPage, OrganizationsPage } from '@/features/console/extracted/organizations'
import { RolesPage } from '@/features/console/extracted/roles'
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
  consoleSharedFetch,
  jsonResponse,
  organization,
  pagination,
  renderWithQuery,
  role,
  signInSettings,
  summaryCard,
} from './console.test-utils'

describe('admin console webhooks-content', () => {
  it('renders content validation errors without sending invalid links', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ContentSettingsPage />)

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Changed Auth' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save content' }))

    expect(await screen.findByText('Content save failed.')).toBeTruthy()
  })

  it('uses empty content link defaults when optional links are absent', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            links: { termsUri: null, privacyUri: null, supportEmail: null },
          }),
        )
      }
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
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
})
