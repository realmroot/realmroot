import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailPage } from '@/features/console/extracted/applications/application-detail'
import { UsersPage } from '@/features/console/extracted/users/users-list'
import { AppRouter, queryClient } from '@/router'

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
  configz,
  consoleAccountProfile,
  consoleSharedFetch,
  emptyPagination,
  jsonResponse,
  pagination,
  renderWithQuery,
  signInSettings,
  user,
} from './console.test-utils'

describe('admin console applications-detail-b', () => {
  it('retries application detail loading failures', async () => {
    const requests: string[] = []
    let detailAttempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ApplicationDetailPage applicationId="app-1" />)

    expect(await screen.findByText('Application unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(requests.filter((url) => url === '/api/management/applications/app-1')).toHaveLength(2)
  })

  it('keeps application detail rendering stable when optional list fields are absent from the API response', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
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
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
})
