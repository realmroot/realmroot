import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountManagementSettings } from '@/features/console/extracted/deployment-misc/account-management-settings'
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
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/realm/account-management-policy' && init?.method === 'PATCH') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountManagementSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit account permissions' }))

    await screen.findByRole('switch', { name: 'Profile section' })
    expect(screen.getByRole('heading', { name: 'Visible sections' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Profile field permissions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('switch', { name: 'Profile section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Password section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Connected accounts and apps' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Sessions section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Display name' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Username' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Avatar' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Email changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))

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

    renderWithQuery(<AccountManagementSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit account permissions' }))
    const profile = await screen.findByRole('switch', { name: 'Profile section' })
    fireEvent.click(profile)
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled')).toBe(true),
    )
    expect(profile.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(profile)
    fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Account center save failed.')).toBeTruthy()
  })

  it('retries account permissions loading inside the dialog', async () => {
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

    renderWithQuery(<AccountManagementSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit account permissions' }))
    expect(await screen.findByText('Account center unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('switch', { name: 'Profile section' })).toBeTruthy()
  })

  it('discards a closed draft and keeps the dialog open until saving finishes', async () => {
    let finishSave: (response: Response) => void = () => undefined
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/account-management-policy' && init?.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          finishSave = resolve
        })
      }
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<AccountManagementSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit account permissions' }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Profile section' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Edit account permissions' }))
    expect((await screen.findByRole('switch', { name: 'Profile section' })).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(screen.getByRole('switch', { name: 'Profile section' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Saving…' }).hasAttribute('disabled')).toBe(true)
    finishSave(jsonResponse(accountCenterSettings))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps deferred audit logs out of the Console', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/audit-logs')
    render(<AppRouter />)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Audit logs' })).toBeNull())
    expect(screen.queryByLabelText('Search audit logs')).toBeNull()
  })
})
