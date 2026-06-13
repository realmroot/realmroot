import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { DeploymentSettingsPage } from '@/features/console/extracted/deployment-misc/deployment'
import {
  MfaPage,
  SecurityBlocklistPage,
  SecurityCaptchaPage,
  SecurityGeneralPage,
  SecurityPasswordPolicyPage,
} from '@/features/console/extracted/security-settings'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
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
  brandingSettings,
  connector,
  connectorTemplates,
  consoleSharedFetch,
  jsonResponse,
  pagination,
  readinessIncomplete,
  renderWithQuery,
  securityPolicy,
  signInSettings,
} from './console.test-utils'

describe('admin console connectors', () => {
  it('closes the connector drawer from the overlay', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Google.*Credentials required.*Not enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!
    fireEvent.pointerDown(overlay)
    fireEvent.pointerUp(overlay)
    fireEvent.click(overlay)

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Google' })).toBeNull())
  })

  it('renders Better Auth provider-specific connector fields', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          jsonResponse({ ...connector, providerId: 'cognito', displayName: 'Amazon Cognito' }, 201),
        )
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

    fireEvent.click(await screen.findByRole('button', { name: /Amazon Cognito.*Credentials required.*Not enabled/ }))
    expect(await screen.findByRole('heading', { name: 'Amazon Cognito' })).toBeTruthy()
    expect(screen.getByLabelText('Callback URL')).toHaveProperty(
      'value',
      'http://localhost:3000/api/auth/callback/cognito',
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cognito-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'COGNITO_SECRET' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'auth.example.com' } })
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us-east-1' } })
    fireEvent.change(screen.getByLabelText('User Pool ID'), { target: { value: 'pool-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/connectors',
          body: {
            slug: 'cognito',
            displayName: 'Amazon Cognito',
            enabled: true,
            providerId: 'cognito',
            providerType: 'social',
            clientId: 'cognito-client',
            clientSecret: 'COGNITO_SECRET',
            scopes: ['openid', 'email', 'profile'],
            providerMetadata: {
              domain: 'auth.example.com',
              region: 'us-east-1',
              userPoolId: 'pool-1',
            },
          },
        },
      ])
    })
  })

  it('renders sign-in settings and security policy surfaces', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Identifier-first flow' })).toBeNull()
    expect(screen.queryByText('Recovery and redirects')).toBeNull()
    expect(screen.queryByText('Hosted copy source')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Passkey sign-in' })).toBeNull()

    unmount()
    renderWithQuery(<MfaPage />)

    expect(await screen.findByText('Factors')).toBeTruthy()
    expect(screen.getByText('Passkeys')).toBeTruthy()
    expect(screen.getByText('Authenticator app')).toBeTruthy()
    expect(screen.queryByText('SMS verification code')).toBeNull()
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('value', 'required')
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<SecurityGeneralPage />)
    expect(await screen.findByText('3600s')).toBeTruthy()
  })

  it('renders independent MFA, security, connector, and OIDC settings surfaces', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<MfaPage />)
    expect(await screen.findByText('Backup codes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Prompt policy'), { target: { value: 'optional' } })
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)
    expect(await screen.findByLabelText('Minimum length')).toHaveProperty('disabled', false)
    expect(screen.getByText('Reject repetitive or sequential characters')).toBeTruthy()
    expect(screen.getByLabelText('Required character types')).toHaveProperty('value', '2')

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)
    expect(await screen.findByText('Turnstile')).toBeTruthy()
    expect(screen.getByLabelText('Site key')).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)
    expect(await screen.findByText('Block email subaddressing')).toBeTruthy()
    expect(screen.getByLabelText('Custom email and domain blocklist')).toHaveProperty('disabled', false)

    cleanup()
    renderWithQuery(<ConnectorsPage />)
    expect((await screen.findAllByText('Provider')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Email.*Runtime enabled.*Enabled/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Phone \(SMS\).*Runtime disabled.*Not enabled/ })).toBeTruthy()
    expect(screen.queryByLabelText('Search social connectors')).toBeNull()

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)
    expect(await screen.findByText('Signing keys')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rotate key' })).toBeNull()
  })
})
