import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  configz,
  consoleAccountProfile,
  consolePasskey,
  consoleSecurity,
  consoleSession,
  consoleSharedFetch,
  jsonResponse,
  linkedAccount,
  pagination,
  profile,
  renderWithQuery,
  signInSettings,
  summaryCard,
  user,
  userApplication,
} from './console.test-utils'

describe('admin console users-list', () => {
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
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
      return consoleSharedFetch(input, init)
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
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
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
      return consoleSharedFetch(input, init)
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
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
        return Promise.resolve(jsonResponse({ sessions: [consoleSession], pagination }))
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
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      }
      if (url === '/api/management/users/user-1/passkeys/passkey-1' && method === 'DELETE') {
        requests.push({ method, url, body: null })
        return Promise.resolve(jsonResponse({}))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [consolePasskey], pagination }))
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

      return consoleSharedFetch(input, init)
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
    const fetchedUrls = fetches.map((entry) => entry.url)
    expect(fetchedUrls).toEqual(
      expect.arrayContaining([
        '/api/management/users/user-1',
        '/api/management/users/user-1/security',
        '/api/management/users/user-1/passkeys?',
      ]),
    )
    expect(fetchedUrls).not.toContain('/api/management/users/user-1/sessions?')
    expect(fetchedUrls).not.toContain('/api/management/users/user-1/linked-accounts?')
    expect(fetchedUrls).not.toContain('/api/management/users/user-1/applications?')
    await waitFor(() => {
      const summary = summaryCard('Identity summary')
      expect(summary.getByText('Sessions')).toBeTruthy()
      expect(summary.getByText('Linked accounts')).toBeTruthy()
      expect(summary.getByText('Authorized apps')).toBeTruthy()
      expect(summary.getAllByText('0').length).toBeGreaterThanOrEqual(3)
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
    expect(await screen.findByText('Chrome')).toBeTruthy()
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
})
