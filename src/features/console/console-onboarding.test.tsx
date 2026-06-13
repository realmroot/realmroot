import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApplicationDetailPage } from '@/features/console/extracted/applications/application-detail'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
import { ConsoleOnboardingPage } from '@/features/console/extracted/onboarding'
import { OrganizationsPage } from '@/features/console/extracted/organizations'
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
  brandingSettings,
  configz,
  consoleSharedFetch,
  jsonResponse,
  organization,
  pagination,
  readinessIncomplete,
  renderWithQuery,
  uploadedAsset,
  user,
} from './console.test-utils'

const deviceCodeGrantType = 'urn:ietf:params:oauth:grant-type:device_code'

describe('console onboarding', () => {
  it('uploads application, organization, branding, and favicon assets', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      if (url === '/api/onboarding/status') return Promise.resolve(jsonResponse({ required: false }))
      if (url === '/api/account/profile') return Promise.resolve(jsonResponse({ user }))
      if (url === '/api/management/readiness') {
        return Promise.resolve(
          jsonResponse({ admin: { setupRequired: false, setupHref: '/console/onboarding', missing: [] } }),
        )
      }
      if (init?.method === 'POST') {
        requests.push({
          url,
          method: init.method,
          body: init.body instanceof FormData ? '[form-data]' : init.body,
        })
        return Promise.resolve(jsonResponse({ asset: uploadedAsset }, 201))
      }
      if (url === '/api/management/applications') {
        return Promise.resolve(jsonResponse({ applications: [application], pagination }))
      }
      if (url === '/api/management/applications/app-1') return Promise.resolve(jsonResponse(application))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/organizations') {
        return Promise.resolve(jsonResponse({ organizations: [organization], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ApplicationDetailPage applicationId="app-1" section="branding" />)
    fireEvent.change(await screen.findByLabelText('Upload logo for Customer portal'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/applications/app-1/logo',
        method: 'POST',
        body: '[form-data]',
      })
    })

    cleanup()
    renderWithQuery(<OrganizationsPage />)
    fireEvent.change(await screen.findByLabelText('Upload logo for Acme'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })

    cleanup()
    renderWithQuery(<BrandingPage />)
    fireEvent.change(await screen.findByLabelText('Upload branding logo'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    fireEvent.change(screen.getByLabelText('Upload favicon'), {
      target: { files: [new File(['icon'], 'favicon.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          { url: '/api/management/organizations/org-1/logo', method: 'POST', body: '[form-data]' },
          { url: '/api/management/branding/logo', method: 'POST', body: '[form-data]' },
          { url: '/api/management/branding/favicon', method: 'POST', body: '[form-data]' },
        ]),
      )
    })
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
      if (url.includes('/api/management/readiness')) return Promise.resolve(jsonResponse(readinessIncomplete))
      if (url === '/api/management/applications' && init?.method === 'POST') {
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
          url: '/api/management/applications',
          body: {
            name: 'Review app',
            slug: 'review-app',
            clientType: 'public_native',
            firstParty: true,
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
      if (url.includes('/api/management/readiness')) return Promise.resolve(jsonResponse(readinessIncomplete))
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
