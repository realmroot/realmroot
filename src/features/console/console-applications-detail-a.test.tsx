import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationsPage } from '@/features/console/extracted/applications/applications-list'
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
  jsonResponse,
  pagination,
  renderWithQuery,
  signInSettings,
  uploadedAsset,
} from './console.test-utils'

describe('admin console applications-detail-a', () => {
  it('renders application list rows with compact client metadata', async () => {
    const thirdPartyApplication = { ...application, id: 'app-2', firstParty: false, name: 'Partner app' }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application, thirdPartyApplication], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationsPage />)

    expect(await screen.findByText('Customer portal')).toBeTruthy()
    expect(screen.getByText('My app')).toBeTruthy()
    expect(screen.getByText('client-1')).toBeTruthy()
    expect(screen.getByText('Public SPA')).toBeTruthy()
    expect(screen.queryByLabelText('Upload logo for Customer portal')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Third-party apps' }))
    expect(await screen.findByText('Partner app')).toBeTruthy()
    expect(screen.getByText('Third-party')).toBeTruthy()
    expect(screen.queryByLabelText('Upload logo for Partner app')).toBeNull()
  })

  it('renders application detail lifecycle, redirect/origin/custom-data editing, and integration controls', async () => {
    const requests: Array<{ url: string; body: unknown; method: string }> = []
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    let currentApplication = application
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
      if (url === '/api/management/applications/app-1' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        requests.push({ url, method, body })
        currentApplication = { ...currentApplication, ...body }
        return Promise.resolve(jsonResponse(currentApplication))
      }
      if (url === '/api/management/applications/app-1/logo' && method === 'POST') {
        requests.push({ url, method, body: init?.body instanceof FormData ? '[form-data]' : init?.body })
        return Promise.resolve(jsonResponse({ asset: uploadedAsset }, 201))
      }
      if (url === '/api/management/applications/app-1' && method === 'DELETE') {
        requests.push({ url, method, body: null })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(currentApplication))
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/console/applications/app-1')

    render(<AppRouter />)

    expect(await screen.findByRole('heading', { name: 'Customer portal' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Branding' })).toBeTruthy()
    expect(screen.getByLabelText('Application name')).toHaveProperty('value', 'Customer portal')
    expect(screen.getByLabelText('Post sign-out redirect URIs')).toHaveProperty(
      'value',
      'https://app.example.com/signed-out',
    )
    expect(screen.getByLabelText('CORS origins')).toHaveProperty('value', 'https://app.example.com')
    expect(screen.getByLabelText('Custom data JSON')).toHaveProperty('value', '{\n  "plan": "enterprise"\n}')
    expect(screen.queryByText('Backchannel logout')).toBeNull()
    expect(screen.queryByText('Token exchange')).toBeNull()
    expect(screen.queryByText('Concurrent device limit')).toBeNull()
    expect(screen.getByText('https://auth.example.com/authorize')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/token')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/userinfo')).toBeTruthy()
    expect(screen.getByText('https://auth.example.com/jwks')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Access token roles' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'ID token roles' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'UserInfo organization name' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(screen.getByText('No client secret is issued for public clients.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Application name'), {
      target: { value: 'Customer portal updated' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { name: 'Customer portal updated', description: null },
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy client config' }))
    expect(JSON.parse(clipboard.writeText.mock.calls[0]?.[0])).toEqual({
      issuer: 'https://auth.example.com',
      discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
      clientId: 'client-1',
      redirectUris: ['https://app.example.com/callback'],
      postLogoutRedirectUris: ['https://app.example.com/signed-out'],
      corsOrigins: ['https://app.example.com'],
      scopes: 'openid profile',
      tokenEndpointAuthMethod: 'none',
      customData: { plan: 'enterprise' },
    })

    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'https://new.example.com/callback' },
    })
    fireEvent.change(screen.getByLabelText('Post sign-out redirect URIs'), {
      target: { value: 'https://new.example.com/signed-out' },
    })
    fireEvent.change(screen.getByLabelText('CORS origins'), {
      target: { value: 'https://new.example.com\nhttp://localhost:4173' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirects and origins' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: {
          redirectUris: ['https://new.example.com/callback'],
          postLogoutRedirectUris: ['https://new.example.com/signed-out'],
          corsOrigins: ['https://new.example.com', 'http://localhost:4173'],
        },
      })
    })

    const redirectUrisInput = screen.getByLabelText('Redirect URIs')
    redirectUrisInput.removeAttribute('required')
    fireEvent.change(redirectUrisInput, {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save redirects and origins' }))
    expect(await screen.findByText('Too small: expected array to have >=1 items')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { customData: {} },
      })
    })

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '{"plan":"growth","beta":true}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { customData: { plan: 'growth', beta: true } },
      })
    })

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '["not-an-object"]' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    expect(await screen.findByText('Custom data JSON must be an object.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save custom data' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: { customData: {} },
      })
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Access token organization ID' }))
    fireEvent.click(screen.getByRole('switch', { name: 'ID token roles' }))
    fireEvent.click(screen.getByRole('switch', { name: 'ID token permissions' }))
    fireEvent.click(screen.getByRole('switch', { name: 'UserInfo organization name' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save OIDC claims' }))
    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1',
        method: 'PATCH',
        body: {
          oidcClaims: {
            accessToken: {
              authorization: true,
              roles: true,
              permissions: true,
              organizationId: true,
            },
            idToken: {
              roles: true,
              permissions: true,
            },
            userInfo: {
              organizationName: true,
            },
          },
        },
      })
    })
    expect(screen.getByRole('switch', { name: 'Access token organization ID' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.queryByLabelText('Client secret')).toBeNull()

    fireEvent.change(screen.getByLabelText('Custom data JSON'), {
      target: { value: '{"plan":"discarded"}' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard' }).at(-1) as HTMLButtonElement)
    expect(screen.getByLabelText('Custom data JSON')).toHaveProperty('value', '{}')
    fireEvent.click(screen.getByRole('tab', { name: 'Branding' }))
    expect(screen.getByText('Display name')).toBeTruthy()
    expect(screen.getByText('Homepage URL')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Upload logo for Customer portal updated'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable application' }))
    expect(await screen.findByRole('button', { name: 'Enable application' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enable application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete application' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete application' }).at(-1) as HTMLButtonElement)

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { name: 'Customer portal updated', description: null },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: {
            redirectUris: ['https://new.example.com/callback'],
            postLogoutRedirectUris: ['https://new.example.com/signed-out'],
            corsOrigins: ['https://new.example.com', 'http://localhost:4173'],
          },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { customData: {} },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { customData: { plan: 'growth', beta: true } },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { customData: {} },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: {
            oidcClaims: {
              accessToken: {
                authorization: true,
                roles: true,
                permissions: true,
                organizationId: true,
              },
              idToken: {
                roles: true,
                permissions: true,
              },
              userInfo: {
                organizationName: true,
              },
            },
          },
        },
        {
          url: '/api/management/applications/app-1/logo',
          method: 'POST',
          body: '[form-data]',
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { disabled: true, disabledReason: 'Disabled from Console' },
        },
        {
          url: '/api/management/applications/app-1',
          method: 'PATCH',
          body: { disabled: false, disabledReason: null },
        },
        { url: '/api/management/applications/app-1', method: 'DELETE', body: null },
      ])
    })
    await waitFor(() => expect(window.location.pathname).toBe('/console/applications'))
  }, 10_000)

  it('shows confidential client secret metadata and one-time rotated secret material', async () => {
    const confidentialApplication = {
      ...application,
      clientType: 'confidential_web',
      public: false,
      requirePkce: false,
      tokenEndpointAuthMethod: 'client_secret_basic',
      secretMetadata: [
        {
          id: 'secret-1',
          version: 1,
          prefix: 'fas_existing',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
        },
      ],
    }
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
      if (url.startsWith('/api/management/applications/app-1/client-secrets') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            clientSecret: 'fas_rotated_secret',
            secret: {
              id: 'secret-2',
              version: 2,
              prefix: 'fas_rotated',
              status: 'active',
              createdAt: '2026-01-02T00:00:00.000Z',
              expiresAt: null,
              revokedAt: null,
            },
          }),
        )
      }
      if (url.startsWith('/api/management/applications/app-1/client-secrets')) {
        return Promise.resolve(jsonResponse({ secrets: confidentialApplication.secretMetadata, pagination }))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(confidentialApplication))
      return consoleSharedFetch(input, init)
    })
    window.history.pushState(null, '', '/console/applications/app-1')

    render(<AppRouter />)

    expect(await screen.findByText('fas_existing')).toBeTruthy()
    expect(screen.queryByText('fas_rotated_secret')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate client secret' }))

    expect(await screen.findByText('fas_rotated_secret')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0])
    await waitFor(() => expect(screen.queryByText('fas_rotated_secret')).toBeNull())
  })
})
