import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountCenterSettingsPage } from '@/features/console/extracted/branding-content/account-center-settings'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { DeploymentSettingsPage } from '@/features/console/extracted/deployment-misc/deployment'
import { CustomizeJwtPage } from '@/features/console/extracted/deployment-misc/misc'
import { WebhooksPage } from '@/features/console/extracted/deployment-misc/webhooks'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
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
  accountCenterSettings,
  brandingSettings,
  connector,
  connectorTemplates,
  consoleRouteFetch,
  consoleSharedFetch,
  jsonResponse,
  pagination,
  renderWithQuery,
  securityPolicy,
  signInSettings,
  webhookEndpoint,
  webhookRequest,
} from './console.test-utils'

describe('admin console branding-content-b', () => {
  it('uses default branding form values when optional branding settings are absent', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') {
        return Promise.resolve(
          jsonResponse({
            branding: {
              logoUrl: null,
              faviconUrl: null,
              primaryColor: null,
              backgroundColor: null,
              customCss: null,
            },
            copy: brandingSettings.copy,
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    expect(await screen.findByDisplayValue('Acme Auth')).toBeTruthy()
    expect(screen.getByLabelText('Logo URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Primary color')).toHaveProperty('value', '#b42318')
    expect(screen.getByLabelText('Background color')).toHaveProperty('value', '#f7f3ee')
    expect(screen.getByLabelText('Custom CSS')).toHaveProperty('value', '')
    fireEvent.change(screen.getByLabelText('Logo URL'), { target: { value: 'https://cdn.example.com/changed.svg' } })
    fireEvent.change(screen.getByLabelText('Favicon URL'), {
      target: { value: 'https://cdn.example.com/changed.ico' },
    })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#0f766e' } })
    fireEvent.change(screen.getByLabelText('Background color'), { target: { value: '#f8fafc' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: '--auth-panel-radius: 16px;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(screen.getByLabelText('Logo URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Primary color')).toHaveProperty('value', '#b42318')
    expect(screen.getByLabelText('Background color')).toHaveProperty('value', '#f7f3ee')
    expect(screen.getByLabelText('Custom CSS')).toHaveProperty('value', '')
  })

  it('renders sign-in and account configuration tabs without v1 dead-end controls [spec: admin-console/admin-account-center-settings]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/account-center-settings') {
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect((await screen.findByRole('link', { name: 'Account Center' })).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('link', { name: 'Collect user profile' })).toBeNull()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    await screen.findByRole('switch', { name: 'Profile section' })
    expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Profile section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Password section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Connected accounts and apps' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Sessions section' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Display name' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Username' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Avatar' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Email changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open account center' }))
    expect(openSpy).toHaveBeenCalledWith('/profile', '_blank', 'noopener')
    fireEvent.click(screen.getByRole('button', { name: 'Save account center' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/management/account-center-settings',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"sessionsViewEnabled":false'),
        }),
      ),
    )

    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            signIn: {
              ...signInSettings.signIn,
              passwordEnabled: false,
              emailOtpEnabled: true,
            },
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()

    cleanup()
    renderWithQuery(<ContentSettingsPage />)

    expect((await screen.findByRole('link', { name: 'Content' })).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByLabelText('Language')).toBeNull()
    expect(await screen.findByLabelText('Sign-in message')).toHaveProperty('value', 'Sign in to Acme Auth')
  })

  it('renders routed connector, account, tenant, and webhook settings tabs with active states', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/account-center-settings') {
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      if (url === '/api/management/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect((await screen.findByRole('link', { name: 'Account Center' })).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('heading', { name: 'Profile field permissions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open account center' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull()

    cleanup()
    renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByRole('heading', { name: 'Connectors' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Passwordless' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Social' })).toBeNull()

    cleanup()
    renderWithQuery(<WebhooksPage section="requests" />)

    expect(screen.getByRole('link', { name: 'Requests' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Endpoints' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByLabelText('Search webhooks')).not.toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Filter webhook status')).not.toHaveProperty('disabled', true)

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)

    expect((await screen.findByRole('link', { name: 'OIDC configs' })).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('tab', { name: 'Private key' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Cookie key' }))
    expect(screen.getByRole('tab', { name: 'Cookie key' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByText('Cookie cache').length).toBeGreaterThan(1)
  })

  it('discards account center edits and surfaces a save error', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/account-center-settings' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Account center save failed.' } }, 500))
      }
      if (url === '/api/management/account-center-settings') {
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    const profileSwitch = await screen.findByRole('switch', { name: 'Profile section' })
    expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull()
    fireEvent.click(profileSwitch)
    // changes section becomes visible
    expect(await screen.findByRole('button', { name: 'Save account center' })).toBeTruthy()
    // discard restores the loaded form, hiding the changes section
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save account center' })).toBeNull())

    // edit again and save -> error surfaces inside the changes section
    fireEvent.click(screen.getByRole('switch', { name: 'Profile section' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save account center' }))
    expect(await screen.findByText('Account center save failed.')).toBeTruthy()
  })

  it('renders the collect user profile read-only surface', async () => {
    const { CollectUserProfilePage } = await import('@/features/console/extracted/branding-content/collect-profile')
    vi.spyOn(window, 'fetch').mockImplementation(consoleSharedFetch)
    renderWithQuery(<CollectUserProfilePage />)
    expect(await screen.findByRole('heading', { name: 'Supported profile data' })).toBeTruthy()
    expect(screen.getAllByText('Built in').length).toBeGreaterThan(0)
    expect(screen.getByText('Custom profile field collection is outside the v1 hosted auth surface.')).toBeTruthy()
  })

  it('opens account center from the account configuration tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    let accountCenterRequests = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/account-center-settings') {
        accountCenterRequests += 1
        if (accountCenterRequests === 1) {
          return Promise.resolve(jsonResponse({ error: { message: 'Account center unavailable.' } }, 503))
        }
        return Promise.resolve(jsonResponse(accountCenterSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<AccountCenterSettingsPage />)

    expect(await screen.findByText('Account center unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open account center' }))

    expect(open).toHaveBeenCalledWith('/profile', '_blank', 'noopener')
  })

  it('manages webhook endpoint controls and request detail through the management API', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      requests.push({ url, method, body })

      if (url.startsWith('/api/management/webhooks/endpoints') && method === 'GET') {
        return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
      }
      if (url === '/api/management/webhooks/endpoints' && method === 'POST') {
        return Promise.resolve(jsonResponse({ endpoint: webhookEndpoint, signingSecret: 'whsec_created_secret' }, 201))
      }
      if (url === '/api/management/webhooks/endpoints/wh_1' && method === 'PATCH') {
        return Promise.resolve(jsonResponse({ ...webhookEndpoint, enabled: false }))
      }
      if (url === '/api/management/webhooks/endpoints/wh_1/secrets' && method === 'POST') {
        return Promise.resolve(jsonResponse({ endpoint: webhookEndpoint, signingSecret: 'whsec_rotated_secret' }, 201))
      }
      if (url === '/api/management/webhooks/endpoints/wh_1' && method === 'DELETE') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url.startsWith('/api/management/webhooks/requests') && method === 'GET') {
        return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
      }
      if (url === '/api/management/webhooks/requests/whr_1/retries' && method === 'POST') {
        return Promise.resolve(jsonResponse({ ...webhookRequest, status: 'pending' }, 202))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<WebhooksPage />)

    expect(await screen.findByRole('heading', { name: 'Webhooks' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Endpoint URL'), {
      target: { value: 'https://events.example.com/auth' },
    })
    fireEvent.click(screen.getByLabelText('session.revoked'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Create endpoint' })[0])

    await screen.findByText('whsec_created_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }))
    expect(writeText).toHaveBeenCalledWith('whsec_created_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(requests).toContainEqual({
      url: '/api/management/webhooks/endpoints',
      method: 'POST',
      body: {
        url: 'https://events.example.com/auth',
        events: ['user.created', 'session.revoked'],
        enabled: true,
      },
    })

    fireEvent.change(screen.getByLabelText('Search webhooks'), { target: { value: 'auth' } })
    fireEvent.change(screen.getByLabelText('Filter webhook status'), { target: { value: 'enabled' } })
    await waitFor(() =>
      expect(
        requests.some((request) => request.url.includes('search=auth') && request.url.includes('status=enabled')),
      ).toBe(true),
    )

    fireEvent.click(await screen.findByRole('switch', { name: 'Enabled' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/webhooks/endpoints/wh_1',
        method: 'PATCH',
        body: { enabled: false },
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rotate secret' }))
    await screen.findByText('whsec_rotated_secret')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.url === '/api/management/webhooks/endpoints/wh_1' && request.method === 'DELETE',
        ),
      ).toBe(true),
    )

    cleanup()
    renderWithQuery(<WebhooksPage section="requests" />)

    expect((await screen.findByRole('link', { name: 'Requests' })).getAttribute('aria-current')).toBe('page')
    fireEvent.change(screen.getByLabelText('Filter webhook status'), { target: { value: 'failed' } })
    await waitFor(() => expect(requests.some((request) => request.url.includes('status=failed'))).toBe(true))
    fireEvent.click(await screen.findByRole('button', { name: 'user.created' }))
    expect(await screen.findByText('Webhook request')).toBeTruthy()
    expect(screen.getByText('Server error')).toBeTruthy()
    expect(screen.getByText('Request body')).toBeTruthy()
    expect(screen.getByText('Response body')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/webhooks/requests/whr_1/retries',
        method: 'POST',
        body: null,
      }),
    )
  })

  it('handles webhook empty states, event toggling, and create errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/management/webhooks/endpoints') && method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Endpoint create failed.' } }, 500))
      }
      if (url.startsWith('/api/management/webhooks/endpoints') && method === 'GET') {
        return Promise.resolve(jsonResponse({ endpoints: [], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<WebhooksPage />)

    // empty endpoint table state
    expect(await screen.findByText('No webhook endpoints')).toBeTruthy()

    // user.created starts selected; toggle it off then back on
    fireEvent.click(screen.getByRole('switch', { name: 'user.created' }))
    fireEvent.click(screen.getByRole('switch', { name: 'user.created' }))
    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://events.example.com/auth' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create endpoint' })[0])

    // create error badge surfaces the failure message
    expect(await screen.findByText('Endpoint create failed.')).toBeTruthy()
  })

  it('ignores an invalid webhook endpoint submission', async () => {
    const posts: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url.startsWith('/api/management/webhooks/endpoints') && method === 'POST') {
        posts.push(url)
        return Promise.resolve(jsonResponse({ endpoint: webhookEndpoint, signingSecret: 'x' }, 201))
      }
      if (url.startsWith('/api/management/webhooks/endpoints') && method === 'GET') {
        return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<WebhooksPage />)

    expect(await screen.findByRole('heading', { name: 'Webhooks' })).toBeTruthy()
    // submit the create form with an empty (invalid) URL -> safeParse fails, no POST
    const urlField = screen.getByLabelText('Endpoint URL') as HTMLInputElement
    fireEvent.submit(urlField.closest('form')!)
    await waitFor(() => expect(posts).toEqual([]))
  })

  it('renders pending webhook request badges and an empty request state on filter', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url.startsWith('/api/management/webhooks/requests')) {
        // a filtered (non-failed) status returns no rows; the default load shows a pending row
        const empty = url.includes('status=') && !url.includes('status=failed')
        return Promise.resolve(
          jsonResponse({
            requests: empty ? [] : [{ ...webhookRequest, status: 'pending', error: null }],
            pagination,
          }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<WebhooksPage section="requests" />)

    expect(await screen.findByText('Pending')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter webhook status'), { target: { value: 'delivered' } })
    expect(await screen.findByText('No webhook requests')).toBeTruthy()
  })

  it('hides deferred audit logs and unavailable JWT controls', async () => {
    renderWithQuery(<CustomizeJwtPage />)

    expect(screen.getByRole('heading', { name: 'Custom JWT' })).toBeTruthy()
    expect(screen.queryByText(/Unavailable/i)).toBeNull()
    expect(screen.queryByText(/Arbitrary claim editor/i)).toBeNull()
    expect(screen.queryByText(/Interactive user fields/i)).toBeNull()

    cleanup()
    vi.spyOn(window, 'fetch').mockImplementation(consoleRouteFetch)
    window.history.pushState(null, '', '/console/audit-logs')

    render(<AppRouter />)

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Audit logs' })).toBeNull())
    expect(screen.queryByLabelText('Search audit logs')).toBeNull()
  })

  it('saves content settings through the sign-in management boundary [spec: admin-console/admin-content-settings]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ContentSettingsPage />)

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Sign-in message'), { target: { value: 'Welcome to Northstar' } })
    fireEvent.change(screen.getByLabelText('Sign-up message'), { target: { value: 'Create your Northstar identity.' } })
    fireEvent.change(screen.getByLabelText('Terms URL'), { target: { value: 'https://northstar.example.com/terms' } })
    fireEvent.change(screen.getByLabelText('Privacy URL'), {
      target: { value: 'https://northstar.example.com/privacy' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'support@northstar.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save content' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/sign-in-settings',
          body: {
            links: {
              termsUri: 'https://northstar.example.com/terms',
              privacyUri: 'https://northstar.example.com/privacy',
              supportEmail: 'support@northstar.example',
            },
            copy: {
              productName: 'Northstar ID',
              headline: 'Welcome to Northstar',
              description: 'Create your Northstar identity.',
            },
          },
        },
      ]),
    )
  })

  it('discards content edits back to loaded hosted auth copy', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ContentSettingsPage />)

    const productName = (await screen.findByLabelText('Product name')) as HTMLInputElement
    fireEvent.change(productName, { target: { value: 'Changed product' } })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'changed@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(productName.value).toBe('Acme Auth')
    expect(screen.getByLabelText('Support email')).toHaveProperty('value', 'support@example.com')
    expect(requests).toEqual([])
  })
})
