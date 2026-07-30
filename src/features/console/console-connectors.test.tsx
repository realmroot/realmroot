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
  it('creates a reusable manual OIDC connector [spec: admin-console/admin-oidc-connector-inventory]', async () => {
    const requests: Array<{ method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors' && init?.method === 'POST') {
        requests.push({ method: init.method, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          jsonResponse(
            {
              ...connector,
              id: 'connector-oidc',
              slug: 'projects',
              providerType: 'generic_oauth',
              providerId: 'projects',
              displayName: 'Projects OIDC',
              loginEnabled: true,
              issuer: 'https://idp.example.com',
              registrationMode: 'manual',
            },
            201,
          ),
        )
      }
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByText('No OIDC connectors yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add OIDC connector' }))
    expect(await screen.findByRole('heading', { name: 'New OIDC connector' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Projects OIDC' } })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'projects' } })
    fireEvent.change(screen.getByLabelText('OIDC issuer'), { target: { value: 'https://idp.example.com' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-1' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'secret-1' } })
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'openid profile' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Allow hosted login' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          method: 'POST',
          body: expect.objectContaining({
            slug: 'projects',
            providerId: 'projects',
            providerType: 'generic_oauth',
            displayName: 'Projects OIDC',
            issuer: 'https://idp.example.com',
            registrationMode: 'manual',
            clientId: 'client-1',
            clientSecret: 'secret-1',
            loginEnabled: true,
            scopes: ['openid', 'profile'],
          }),
        },
      ]),
    )
  })

  it('creates an OIDC connector with dynamic registration', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(
          jsonResponse(
            {
              ...connector,
              id: 'connector-dynamic',
              slug: 'dynamic-oidc',
              providerType: 'generic_oauth',
              providerId: 'dynamic-oidc',
              displayName: 'Dynamic OIDC',
              issuer: 'https://dynamic.example.com',
              registrationMode: 'dynamic',
            },
            201,
          ),
        )
      }
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add OIDC connector' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dynamic OIDC' } })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'dynamic-oidc' } })
    fireEvent.change(screen.getByLabelText('Client registration'), { target: { value: 'dynamic' } })
    fireEvent.change(screen.getByLabelText('OIDC issuer'), { target: { value: 'https://dynamic.example.com' } })
    expect(screen.queryByLabelText('Client ID')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          providerId: 'dynamic-oidc',
          registrationMode: 'dynamic',
          issuer: 'https://dynamic.example.com',
        }),
      ]),
    )
  })

  it('updates and deletes an existing OIDC connector', async () => {
    const oidcConnector = {
      ...connector,
      id: 'connector-oidc',
      slug: 'projects',
      providerType: 'generic_oauth' as const,
      providerId: 'projects',
      displayName: 'Projects OIDC',
      enabled: false,
      loginEnabled: true,
      clientSecretConfigured: false,
      issuer: 'https://idp.example.com',
      registrationMode: 'manual' as const,
    }
    const requests: Array<{ method: string; body?: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors/connector-oidc' && init?.method === 'PATCH') {
        requests.push({ method: init.method, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...oidcConnector, enabled: true, loginEnabled: false }))
      }
      if (url === '/api/connectors/connector-oidc' && init?.method === 'DELETE') {
        requests.push({ method: init.method })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/connectors/connector-oidc') return Promise.resolve(jsonResponse(oidcConnector))
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [oidcConnector], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    const row = await screen.findByRole('button', { name: /Projects OIDC/ })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Projects OIDC' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false))
    expect(screen.getByLabelText('OIDC issuer')).toHaveProperty('readOnly', true)
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow hosted login' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PATCH',
        body: expect.objectContaining({
          enabled: true,
          loginEnabled: false,
          clientId: 'client-2',
        }),
      }),
    )

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Projects OIDC' })).toBeNull())
    fireEvent.keyDown(screen.getByRole('button', { name: /Projects OIDC/ }), { key: ' ' })
    expect(await screen.findByRole('heading', { name: 'Projects OIDC' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE' }))
  })

  it('shows connector form validation errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Google.*Credentials required.*Not enabled/ }))
    const enabled = screen.getByRole('switch', { name: 'Enabled' })
    fireEvent.click(enabled)
    await waitFor(() => expect(enabled.getAttribute('data-state')).toBe('checked'))
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!)
    expect(await screen.findByText('clientId is required.')).toBeTruthy()
  })

  it('closes the connector drawer from the overlay', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/connectors') {
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

  it('renders Better Auth provider-specific connector fields [spec: admin-console/admin-create-connector]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(
          jsonResponse({ ...connector, providerId: 'cognito', displayName: 'Amazon Cognito' }, 201),
        )
      }
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/connectors') {
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
          url: '/api/connectors',
          body: {
            slug: 'cognito',
            displayName: 'Amazon Cognito',
            enabled: true,
            loginEnabled: true,
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
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
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

  it('renders independent MFA, security, connector, and OIDC settings surfaces [spec: admin-console/admin-connector-inventory] [spec: admin-console/admin-oidc-connector-inventory] [spec: admin-console/admin-security-policy]', async () => {
    const oidcConnector = {
      ...connector,
      id: 'connector-oidc',
      slug: 'projects',
      providerType: 'generic_oauth' as const,
      providerId: 'projects',
      displayName: 'Projects OIDC',
      loginEnabled: false,
      issuer: 'https://projects.example.com',
      registrationMode: 'manual' as const,
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/readiness') return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector, oidcConnector], pagination }))
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
    expect(screen.getByRole('heading', { name: 'OIDC connectors' })).toBeTruthy()
    expect(screen.getByText('Projects OIDC')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add OIDC connector' })).toBeTruthy()

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)
    expect(await screen.findByText('Signing keys')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rotate key' })).toBeNull()
  })
})
