import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountCenterSettingsPage } from '@/features/console/extracted/branding-content/account-center-settings'
import { CustomizeJwtPage } from '@/features/console/extracted/deployment-misc/misc'
import { AppRouter, queryClient } from '@/router'
import {
  accountCenterSettings,
  consoleRouteFetch,
  consoleSharedFetch,
  jsonResponse,
  renderWithQuery,
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

describe('admin console account center and deferred configuration', () => {
  it('persists Account Center visibility and field permissions [spec: admin-console/admin-account-center-settings]', async () => {
    const requests: unknown[] = []
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/realm/account-management-policy' && init?.method === 'PATCH') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect(await screen.findByRole('heading', { name: 'Account Center' })).toBeTruthy()
    await screen.findByRole('switch', { name: 'Profile section' })
    expect(screen.getByRole('heading', { name: 'Visible sections' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Profile field permissions' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Profile section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Password section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Connected accounts and apps' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Sessions section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Display name' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Username' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Avatar' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Email changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open account center' }))
    expect(open).toHaveBeenCalledWith('/profile', '_blank', 'noopener')
    fireEvent.click(await screen.findByRole('button', { name: 'Save account center' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          accountCenter: {
            avatarEditable: false,
            connectedAccountsEnabled: false,
            dangerZoneEnabled: false,
            displayNameEditable: false,
            emailChangeEnabled: false,
            passwordChangeEnabled: false,
            profileEditingEnabled: false,
            sessionsViewEnabled: false,
            usernameEditable: false,
          },
        },
      ]),
    )
  })

  it('discards Account Center edits and surfaces management boundary errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/realm/account-management-policy' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Account center save failed.' } }, 500))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)
    const profile = await screen.findByRole('switch', { name: 'Profile section' })
    fireEvent.click(profile)
    expect(await screen.findByRole('button', { name: 'Save account center' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull())
    expect(profile.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(profile)
    fireEvent.click(await screen.findByRole('button', { name: 'Save account center' }))
    expect(await screen.findByText('Account center save failed.')).toBeTruthy()
  })

  it('retries Account Center loading and opens the live surface after recovery', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let attempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/account-management-policy') {
        attempts += 1
        return attempts === 1
          ? Promise.resolve(jsonResponse({ error: { message: 'Account center unavailable.' } }, 503))
          : Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)
    expect(await screen.findByText('Account center unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open account center' }))
    expect(open).toHaveBeenCalledWith('/profile', '_blank', 'noopener')
  })

  it('keeps deferred audit logs and unsupported arbitrary JWT editors out of the Console', async () => {
    renderWithQuery(<CustomizeJwtPage />)
    expect(await screen.findByRole('heading', { name: 'Custom JWT' })).toBeTruthy()
    expect(screen.queryByText(/Arbitrary claim editor/i)).toBeNull()
    expect(screen.queryByText(/Interactive user fields/i)).toBeNull()

    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/audit-logs')
    render(<AppRouter />)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Audit logs' })).toBeNull())
    expect(screen.queryByLabelText('Search audit logs')).toBeNull()
  })
})
