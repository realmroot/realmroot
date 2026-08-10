import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationsPage } from '@/features/applications/management/applications-list'
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
  application,
  consoleSharedFetch,
  jsonResponse,
  pagination,
  readinessIncomplete,
  renderWithQuery,
} from './console.test-utils'

describe('admin console applications-list', () => {
  it('binds Organization Workspace inventory and creation to its Organization [spec: admin-console/organization-console-resource-boundary]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = request ? new URL(request.url) : new URL(String(input), window.location.origin)
      requests.push(`${url.pathname}${url.search}`)
      if (url.pathname === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage organizationId="org-1" />)

    const applicationLink = await screen.findByRole('link', { name: 'Customer portal' })
    expect(applicationLink.getAttribute('href')).toBe('/organizations/org-1/applications/app-1')
    expect(screen.queryByLabelText('Filter owner')).toBeNull()
    expect(requests).toContain('/api/applications?ownerOrganizationId=org-1')
    expect(requests).not.toContain('/api/users?limit=100&organizationId=org-1')
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    expect(screen.queryByLabelText('Owner Organization')).toBeNull()
  })

  it('renders application rows and posts validated create input [spec: admin-console/admin-application-inventory]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url.startsWith('/api/applications')) {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    const dataPanel = screen.getByRole('table').closest('.consoleDataTablePanel')
    expect(screen.getByLabelText('Search applications').closest('.consoleDataTablePanel')).toBe(dataPanel)
    expect(screen.getByRole('columnheader', { name: 'Application' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Resource access' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: 'missing' } })
    expect(await screen.findByText('No applications found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search applications'), { target: { value: 'Customer' } })
    fireEvent.change(screen.getByLabelText('Filter owner'), { target: { value: 'org-1' } })
    fireEvent.change(screen.getByLabelText('Filter type'), { target: { value: 'confidential_web' } })
    expect(await screen.findByText('No applications found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter type'), { target: { value: 'public_spa' } })
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
          url: '/api/applications',
          body: {
            name: 'Admin console',
            slug: 'admin-console',
            clientType: 'confidential_web',
            firstParty: true,
            ownerOrganizationId: 'org-1',
            allowedGrantTypes: ['authorization_code', 'refresh_token'],
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
      if (url === '/api/applications/app-1' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...application, disabled: true }))
      }
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New application' }))
    expect(await screen.findByRole('heading', { name: 'Create application' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Create application' })).toBeNull()

    fireEvent.pointerDown(screen.getByLabelText('Actions for Customer portal'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByText('Disable'))

    await waitFor(() => {
      expect(requests).toEqual([{ url: '/api/applications/app-1', body: { disabled: true } }])
    })
  })

  it('toggles third-party application availability from the unified list', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const thirdPartyApplication = { ...application, id: 'app-2', name: 'Partner app', firstParty: false }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications/app-2' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...thirdPartyApplication, disabled: true }))
      }
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [thirdPartyApplication], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Partner app')).toBeTruthy()
    fireEvent.pointerDown(screen.getByLabelText('Actions for Partner app'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByText('Disable'))

    await waitFor(() => {
      expect(requests).toEqual([{ url: '/api/applications/app-2', body: { disabled: true } }])
    })
  })

  it('shows one-time secret material when creating a confidential application', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications' && init?.method === 'POST') {
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
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
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
    expect(await screen.findByText('Authorization-code clients require at least one redirect URI.')).toBeTruthy()
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
        url: '/api/applications',
        body: {
          name: 'Server app',
          slug: 'server-app',
          clientType: 'confidential_web',
          firstParty: true,
          ownerOrganizationId: 'org-1',
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
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
      if (url.includes('/api/realm/configuration-status')) return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
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
      if (url === '/api/applications' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve
        })
      }
      if (url === '/api/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
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

    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeTruthy()
    resolveCreate(jsonResponse(application, 201))
  })

  it('retries failed application inventory requests', async () => {
    let attempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/applications') {
        attempts += 1
        return Promise.resolve(
          attempts === 1
            ? jsonResponse({ message: 'inventory unavailable' }, 503)
            : jsonResponse({ applications: [application], pagination }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(attempts).toBe(2)
  })
})
