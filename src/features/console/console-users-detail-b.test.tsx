import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
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
  connector,
  connectorTemplates,
  consoleSharedFetch,
  jsonResponse,
  pagination,
  renderWithQuery,
  securityPolicy,
  signInSettings,
} from './console.test-utils'

describe('admin console users-detail-b', () => {
  it('renders the provider catalog and configures social providers from the drawer [spec: admin-console/admin-social-connector-inventory]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(connector, 201))
      }
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Email')).toBeTruthy()
    expect(screen.getByText('Phone (SMS)')).toBeTruthy()
    expect(screen.getByText('Web3 wallet')).toBeTruthy()
    expect(screen.getByText('Passkey')).toBeTruthy()
    expect(screen.getByText('OneTap')).toBeTruthy()
    expect(screen.getByText('Google')).toBeTruthy()
    expect(
      Array.from(screen.getByRole('table').querySelectorAll('tbody tr'))
        .map((row) => row.querySelector('.font-medium')?.textContent)
        .slice(0, 5),
    ).toEqual(['Email', 'Phone (SMS)', 'Web3 wallet', 'Passkey', 'OneTap'])
    expect(screen.queryByRole('link', { name: 'Passwordless' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Social' })).toBeNull()
    expect(screen.queryByLabelText('Search social connectors')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add social connector' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Google.*Credentials required.*Not enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    expect(screen.getByLabelText('Callback URL')).toHaveProperty(
      'value',
      'http://localhost:3000/api/auth/callback/google',
    )
    const fieldLabels = Array.from(screen.getByRole('dialog').querySelectorAll('.field label')).map(
      (label) => label.textContent,
    )
    expect(fieldLabels.at(-1)).toBe('Callback URL')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/api/auth/callback/google')
    expect(screen.getAllByText('Required by this Better Auth provider.')).toHaveLength(2)
    expect(screen.queryByLabelText('Scopes')).toBeNull()
    expect(screen.queryByLabelText('Redirect URI')).toBeNull()
    expect(screen.queryByLabelText('Disable Sign Up')).toBeNull()
    expect(screen.queryByLabelText('Override User Info')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'google-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'GOOGLE_SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/connectors',
          body: {
            slug: 'google',
            displayName: 'Google',
            enabled: true,
            providerId: 'google',
            providerType: 'social',
            clientId: 'google-client',
            clientSecret: 'GOOGLE_SECRET',
            scopes: ['openid', 'email', 'profile'],
          },
        },
      ])
    })
  })

  it('configures built-in email and passkey providers from the drawer', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      if (url === '/api/management/sign-in-settings' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            builtInProviders: {
              ...signInSettings.builtInProviders,
              email: { ...signInSettings.builtInProviders.email, enabled: false },
            },
            signIn: { ...signInSettings.signIn, emailOtpEnabled: false },
          }),
        )
      }
      if (url === '/api/management/sign-in-settings' && method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(
          jsonResponse({ ...signInSettings, signIn: { ...signInSettings.signIn, emailOtpEnabled: true } }),
        )
      }
      if (url === '/api/management/security/policy' && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            policy: { ...securityPolicy.policy, passkeys: { ...securityPolicy.policy.passkeys, enabled: false } },
          }),
        )
      }
      if (url === '/api/management/security/policy' && method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse(securityPolicy))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Email.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Email' })).getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('OTP length'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Code expiry seconds'), { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: { builtInProviders: { email: { enabled: true, otpLength: 8, expiresInSeconds: 600 } } },
      })
    })

    fireEvent.click(within(screen.getByRole('dialog', { name: 'Email' })).getAllByRole('button', { name: 'Close' })[0])
    fireEvent.click(await screen.findByRole('button', { name: /Passkey.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Passkey' })).getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        body: { policy: { passkeys: { enabled: true } } },
      })
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Passkey' })).getAllByRole('button', { name: 'Close' })[0],
    )
    fireEvent.click(await screen.findByRole('button', { name: /Phone \(SMS\).*Runtime disabled.*Not enabled/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Phone (SMS)' })).getByRole('switch', { name: 'Enabled' }),
    )
    expect(
      Array.from(screen.getByLabelText('SMS provider').querySelectorAll('option')).map((option) => option.value),
    ).toEqual(['twilio', 'vonage', 'messagebird'])
    fireEvent.change(screen.getByLabelText('SMS provider'), { target: { value: 'vonage' } })
    expect(screen.getByLabelText('Vonage API key')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('SMS provider'), { target: { value: 'twilio' } })
    fireEvent.change(screen.getByLabelText('Twilio Account SID'), { target: { value: 'AC123' } })
    fireEvent.change(screen.getByLabelText('Twilio Auth Token'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('From number'), { target: { value: '+15551234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: {
          builtInProviders: {
            phone: expect.objectContaining({
              enabled: true,
              smsProvider: 'twilio',
              twilioAccountSid: 'AC123',
              twilioAuthToken: 'secret',
              twilioFromNumber: '+15551234567',
            }),
          },
        },
      })
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Phone (SMS)' })).getAllByRole('button', { name: 'Close' })[0],
    )
    fireEvent.click(await screen.findByRole('button', { name: /Web3 wallet.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Web3 wallet' })).getByRole('switch', { name: 'Enabled' }),
    )
    expect(screen.queryByLabelText('SIWE domain')).toBeNull()
    expect(screen.queryByLabelText('Email domain')).toBeNull()
    fireEvent.click(screen.getByLabelText('Base'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: {
          builtInProviders: {
            web3Wallet: expect.objectContaining({
              enabled: true,
              chains: [1, 8453],
            }),
          },
        },
      })
    })

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Web3 wallet' })).getAllByRole('button', { name: 'Close' })[0],
    )
    fireEvent.click(await screen.findByRole('button', { name: /OneTap.*Runtime disabled.*Not enabled/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'OneTap' })).getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'google-client-id' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        body: {
          builtInProviders: {
            oneTap: expect.objectContaining({
              enabled: true,
              clientId: 'google-client-id',
            }),
          },
        },
      })
    })
  })

  it('edits and deletes configured social providers from the drawer', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors/connector-1' && method === 'GET') {
        return Promise.resolve(jsonResponse(connector))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'PATCH') {
        requests.push({ url, method, body: JSON.parse(String(init?.body)) })
        return Promise.resolve(jsonResponse({ ...connector, enabled: false }))
      }
      if (url === '/api/management/connectors/connector-1' && method === 'DELETE') {
        requests.push({ url, method, body: null })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Google.*Credentials configured.*Enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy())
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'workspace-client' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/connectors/connector-1',
        method: 'PATCH',
        body: expect.objectContaining({ clientId: 'workspace-client', enabled: false }),
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Google' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /Google.*Credentials configured.*Enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Google' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'Delete connector' })).toBeTruthy()
    fireEvent.click(within(screen.getAllByRole('dialog').at(-1)!).getByRole('button', { name: 'Delete' }))
    await waitFor(() => {
      expect(requests).toContainEqual({ url: '/api/management/connectors/connector-1', method: 'DELETE', body: null })
    })
  })
})
