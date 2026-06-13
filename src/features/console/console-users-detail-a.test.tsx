import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  emptyPagination,
  jsonResponse,
  pagination,
  profile,
  signInSettings,
} from './console.test-utils'

describe('admin console users-detail-a', () => {
  it('supports unbanning and confirmed deletion from user detail', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
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
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users')) {
        return Promise.resolve(jsonResponse({ users: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
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
        return Promise.resolve(jsonResponse({ sessions: [consoleSession], pagination }))
      }
      if (url.startsWith('/api/management/users/user-1/linked-accounts')) {
        return Promise.resolve(jsonResponse({ accounts: [], pagination: emptyPagination }))
      }
      if (url.startsWith('/api/management/users/user-1/applications')) {
        return Promise.resolve(jsonResponse({ applications: [], pagination: emptyPagination }))
      }
      if (url === '/api/management/users/user-1/security') {
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [consolePasskey], pagination }))
      }
      return consoleSharedFetch(input, init)
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
    expect(await screen.findByText('Chrome')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: /^Revoke$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }))
    expect(await screen.findByText('MacBook Touch ID')).toBeTruthy()
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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
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
          jsonResponse({ sessions: [{ ...consoleSession, ipAddress: null, userAgent: null }], pagination }),
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
            passkeys: [{ ...consolePasskey, name: null, backedUp: false, createdAt: null }],
            pagination,
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    window.history.pushState(null, '', '/console/users/user-1')
    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'user-1' })).toBeTruthy()
    expect(screen.getByText('Multiple roles: admin, support')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save profile' }).closest('form')?.noValidate).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Security' }))
    expect(await screen.findByText('sms')).toBeTruthy()
    expect(screen.getAllByText('Disabled')).toHaveLength(2)
    expect(await screen.findByText('passkey-1')).toBeTruthy()
    expect(screen.getByText(/not backed up/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    expect(await screen.findByText(/Unknown IP/)).toBeTruthy()

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
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user: consoleAccountProfile }))
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
        return Promise.resolve(jsonResponse({ security: consoleSecurity }))
      }
      if (url.startsWith('/api/management/users/user-1/passkeys')) {
        return Promise.resolve(jsonResponse({ passkeys: [], pagination: emptyPagination }))
      }
      return consoleSharedFetch(input, init)
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
})
