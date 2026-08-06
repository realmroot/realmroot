import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
import { ConsoleOnboardingPage } from '@/features/console/extracted/onboarding'
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
  application,
  consoleSharedFetch,
  jsonResponse,
  readinessIncomplete,
  renderWithQuery,
} from './console.test-utils'

const deviceCodeGrantType = 'urn:ietf:params:oauth:grant-type:device_code'

describe('console onboarding', () => {
  it('returns completed setup to the dashboard [spec: admin-console/admin-onboarding-complete]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.includes('/api/realm/configuration-status')) {
        return Promise.resolve(
          jsonResponse({
            required: [],
            recommended: [],
            admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] },
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    const { router } = renderWithQuery(<ConsoleOnboardingPage />)

    await waitFor(() => expect(router.state.location.pathname).toBe('/console'))
    expect(screen.queryByText('First OIDC application')).toBeNull()
  })

  it('exposes only the designed Realm brand asset URL fields [spec: admin-console/admin-branding]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleSharedFetch)

    renderWithQuery(<BrandingPage />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Brand assets' }))

    expect(await screen.findByLabelText('Product name')).toBeTruthy()
    expect(screen.getByLabelText('Logo URL')).toBeTruthy()
    expect(screen.getByLabelText('Favicon URL')).toBeTruthy()
    expect(screen.queryByLabelText('Upload logo')).toBeNull()
    expect(screen.queryByLabelText('Upload favicon')).toBeNull()
  })

  it('creates the first OIDC client from admin onboarding and copies integration details [spec: admin-console/admin-onboarding]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.includes('/api/realm/configuration-status')) return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/applications' && init?.method === 'POST') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(application, 201))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleOnboardingPage />)

    expect(await screen.findByText('Setup checklist')).toBeTruthy()
    expect(screen.getByText('Create an OIDC application')).toBeTruthy()
    expect(screen.getByText('Confirm email delivery')).toBeTruthy()
    expect(screen.getByDisplayValue('Customer portal')).toBeTruthy()
    expect(screen.getByDisplayValue('customer-portal')).toBeTruthy()
    expect(screen.getByLabelText('Application name')).toHaveProperty('value', 'Customer portal')
    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'customer-portal')
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveProperty('value', 'org-1'))
    expect(screen.getByRole('button', { name: /Single-page app/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('switch', { name: 'Device login' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Native app/ }))
    expect(screen.getByRole('button', { name: /Native app/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: 'Device login' }))
    fireEvent.change(await screen.findByLabelText('Application name'), { target: { value: 'Review app' } })
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'review-app' } })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), {
      target: { value: 'http://localhost:4173/oidc/callback' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create OIDC client' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/applications',
          body: {
            name: 'Review app',
            slug: 'review-app',
            clientType: 'public_native',
            firstParty: true,
            ownerOrganizationId: 'org-1',
            allowedGrantTypes: ['authorization_code', 'refresh_token', deviceCodeGrantType],
            redirectUris: ['http://localhost:4173/oidc/callback'],
          },
        },
      ])
    })
    expect(await screen.findByText('client-1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled())
    expect(JSON.parse(clipboard.writeText.mock.calls[0]?.[0])).toEqual({
      issuer: 'http://localhost:3000/api/auth',
      discoveryUrl: 'http://localhost:3000/api/auth/.well-known/openid-configuration',
      clientId: 'client-1',
      redirectUri: 'http://localhost:4173/oidc/callback',
      scopes: 'openid profile email',
    })
  })

  it('resets device login when switching away from a native client type', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.includes('/api/realm/configuration-status')) return Promise.resolve(jsonResponse(readinessIncomplete))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConsoleOnboardingPage />)

    expect(await screen.findByText('Setup checklist')).toBeTruthy()
    // copy integration details before any client exists -> clientId placeholder branch
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    fireEvent.change(screen.getByLabelText('Redirect URIs'), { target: { value: 'https://app.example.com/cb' } })
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalled())
    expect(JSON.parse(clipboard.writeText.mock.calls[0]?.[0]).clientId).toBe('<create-client-first>')

    fireEvent.click(screen.getByRole('button', { name: /Native app/ }))
    fireEvent.click(screen.getByRole('switch', { name: 'Device login' }))
    expect(screen.getByRole('switch', { name: 'Device login' }).getAttribute('aria-checked')).toBe('true')
    // switching to a non-native type removes the device login control and resets the flag
    fireEvent.click(screen.getByRole('button', { name: /Single-page app/ }))
    expect(screen.queryByRole('switch', { name: 'Device login' })).toBeNull()
    // switching back to native shows it reset to off
    fireEvent.click(screen.getByRole('button', { name: /Native app/ }))
    expect(screen.getByRole('switch', { name: 'Device login' }).getAttribute('aria-checked')).toBe('false')
  })
})
