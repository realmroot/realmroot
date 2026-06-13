import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationsPage } from '@/features/console/extracted/applications/applications-list'
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
      return consoleSharedFetch(input, init)
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
            allowedGrantTypes: ['authorization_code', 'refresh_token'],
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
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
      if (url.includes('/api/management/readiness')) return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/management/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      if (url === '/api/management/applications') {
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
      if (url === '/api/management/applications' && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve
        })
      }
      if (url === '/api/management/applications') {
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

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeTruthy()
    resolveCreate(jsonResponse(application, 201))
  })
})
