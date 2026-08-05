import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

import { consoleSharedFetch, jsonResponse, pagination, renderWithQuery, user } from './console.test-utils'

describe('admin console users-list', () => {
  it('loads Realm inventory and exposes Realm actions', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const raw = input instanceof Request ? input.url : String(input)
      const url = raw.startsWith('http') ? `${new URL(raw).pathname}${new URL(raw).search}` : raw
      if (url.startsWith('/api/users')) {
        requests.push(url)
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const realmView = renderWithQuery(<UsersPage />)
    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    expect(requests[0]).not.toContain('organizationId')
    expect(screen.getByRole('button', { name: 'New user' })).toBeTruthy()
    expect(screen.getByLabelText('Actions for jane@example.com')).toBeTruthy()

    realmView.unmount()
  })

  it('creates users with optional credentials [spec: admin-console/admin-create-user]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/users' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(user, 201))
      }
      if (url.startsWith('/api/users')) {
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
          url: '/api/users',
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
  })

  it('promotes a non-admin user to admin from the list menu', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/users/user-1' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...user, role: 'admin' }))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ users: [{ ...user, role: 'user' }], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.pointerDown(screen.getByLabelText('Actions for jane@example.com'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByText('Make Realm administrator'))

    await waitFor(() => {
      expect(requests.at(-1)).toEqual({ url: '/api/users/user-1', body: { role: ['user', 'admin'] } })
    })
  })

  it('paginates forward through a multi-page user list', async () => {
    const seen: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/users')) {
        seen.push(url)
        return Promise.resolve(
          jsonResponse({
            users: [user],
            pagination: {
              limit: 10,
              offset: url.includes('offset=10') ? 10 : 0,
              total: 30,
              hasMore: !url.includes('offset=10'),
              nextOffset: url.includes('offset=10') ? null : 10,
            },
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await waitFor(() => expect(seen.some((url) => url.includes('offset=10'))).toBe(true))
    // on the last page Next is disabled (nextOffset null / hasMore false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toHaveProperty('disabled', true))
  })

  it('shows client-side validation errors for user creation', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/users' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(user, 201))
      }
      if (url.startsWith('/api/users')) {
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
      if (url === '/api/users' && init?.method === 'POST') {
        return Promise.reject('network failed')
      }
      if (url.startsWith('/api/users')) {
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
      if (url === '/api/users/user-1/password-reset-requests') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ accepted: true }))
      }
      if (url.startsWith('/api/users')) {
        return Promise.resolve(jsonResponse({ users: [user], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<UsersPage />)

    expect(await screen.findByText('jane@example.com')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'jane' } })
    expect(await screen.findByLabelText('Actions for jane@example.com')).toBeTruthy()
    fireEvent.pointerDown(screen.getByLabelText('Actions for jane@example.com'), { button: 0, ctrlKey: false })
    expect(await screen.findByText('Remove Realm administrator')).toBeTruthy()
    fireEvent.click(await screen.findByText('Send password reset'))

    await waitFor(() => {
      expect(requests).toEqual([{ url: '/api/users/user-1/password-reset-requests', body: {} }])
    })
  })

  it('applies user list filters and pagination controls [spec: admin-console/admin-user-inventory]', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('/api/users')) {
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
    expect(screen.getAllByText('User').length).toBeGreaterThanOrEqual(2)
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
    fireEvent.pointerDown(screen.getByLabelText('Actions for user-1'), { button: 0, ctrlKey: false })
    expect(screen.queryByText('Send password reset')).toBeNull()
  })
})
