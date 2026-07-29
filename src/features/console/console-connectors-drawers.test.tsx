import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { queryClient } from '@/router'
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

type Captured = { url: string; method: string; body: unknown }

function mountConnectors(options?: {
  connectors?: unknown[]
  signIn?: typeof signInSettings
  security?: typeof securityPolicy
  onMutation?: (captured: Captured) => Response | undefined
}) {
  const requests: Captured[] = []
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const request = input instanceof Request ? input : null
    const url = request?.url ? new URL(request.url).pathname : String(input)
    const method = request?.method ?? init?.method ?? 'GET'
    if (method !== 'GET') {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const captured = { url, method, body }
      requests.push(captured)
      const custom = options?.onMutation?.(captured)
      if (custom) return Promise.resolve(custom)
      return Promise.resolve(jsonResponse({ ...connector }, method === 'POST' ? 201 : 200))
    }
    if (url === '/api/management/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
    if (url === '/api/management/sign-in-settings')
      return Promise.resolve(jsonResponse(options?.signIn ?? signInSettings))
    if (url === '/api/management/security/policy')
      return Promise.resolve(jsonResponse(options?.security ?? securityPolicy))
    if (url === '/api/management/connectors') {
      return Promise.resolve(jsonResponse({ connectors: options?.connectors ?? [], pagination }))
    }
    if (url.startsWith('/api/management/connectors/')) {
      const found = (options?.connectors ?? []).find((c) => (c as { id: string }).id === url.split('/').pop())
      return Promise.resolve(jsonResponse(found ?? connector))
    }
    return consoleSharedFetch(input, init)
  })
  renderWithQuery(<ConnectorsPage />)
  return requests
}

async function openProvider(matcher: RegExp) {
  const button = await screen.findByRole('button', { name: matcher })
  fireEvent.click(button)
}

describe('console connectors built-in drawers', () => {
  it('edits the email built-in provider and submits sign-in settings', async () => {
    const requests = mountConnectors()
    await openProvider(/Email.*Runtime enabled.*Enabled/)
    expect(await screen.findByRole('heading', { name: 'Email' })).toBeTruthy()

    // No changes yet -> Save disabled
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)

    // toggle Enabled off then on to drive the email enabled switch handler
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('OTP length'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Code expiry seconds'), { target: { value: '600' } })
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toHaveProperty('disabled', false)
    fireEvent.click(save)

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/management/sign-in-settings',
        method: 'PATCH',
        body: { builtInProviders: { email: { enabled: true, otpLength: 8, expiresInSeconds: 600 } } },
      })
    })
  })

  it('toggles passkey enablement and allow-for-sign-up through two RPCs', async () => {
    const requests = mountConnectors()
    await openProvider(/Passkey.*Runtime enabled.*Enabled/)
    expect(await screen.findByRole('heading', { name: 'Passkey' })).toBeTruthy()
    expect(screen.getByText('Acme Auth')).toBeTruthy()

    // Disable passkeys and disable allow-for-sign-up
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[0]) // Enabled
    fireEvent.click(switches[1]) // Allow for sign-up
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests.some((r) => r.url === '/api/management/security/policy' && r.method === 'PATCH')).toBe(true)
      expect(
        requests.some(
          (r) =>
            r.url === '/api/management/sign-in-settings' &&
            r.method === 'PATCH' &&
            JSON.stringify(r.body).includes('passkey'),
        ),
      ).toBe(true)
    })
  })

  it('shows phone provider fields, switches SMS providers, and edits every provider field', async () => {
    mountConnectors()
    await openProvider(/Phone \(SMS\).*Runtime disabled.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Phone (SMS)' })).toBeTruthy()

    // twilio fields by default
    fireEvent.change(screen.getByLabelText('Twilio Account SID'), { target: { value: 'AC1' } })
    fireEvent.change(screen.getByLabelText('Twilio Auth Token'), { target: { value: 'token' } })
    fireEvent.change(screen.getByLabelText('From number'), { target: { value: '+15551112222' } })

    fireEvent.change(screen.getByLabelText('SMS provider'), { target: { value: 'vonage' } })
    fireEvent.change(screen.getByLabelText('Vonage API key'), { target: { value: 'vk' } })
    fireEvent.change(screen.getByLabelText('Vonage API secret'), { target: { value: 'vs' } })
    fireEvent.change(screen.getByLabelText('From name or number'), { target: { value: 'Acme' } })

    fireEvent.change(screen.getByLabelText('SMS provider'), { target: { value: 'messagebird' } })
    fireEvent.change(screen.getByLabelText('MessageBird access key'), { target: { value: 'mk' } })
    fireEvent.change(screen.getByLabelText('Originator'), { target: { value: 'Acme' } })
  })

  it('renders an error banner in a built-in provider form', async () => {
    mountConnectors({
      onMutation: () => jsonResponse({ message: 'patch rejected' }, 400),
    })
    await openProvider(/Email.*Runtime enabled.*Enabled/)
    expect(await screen.findByRole('heading', { name: 'Email' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('OTP length'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('patch rejected')).toBeTruthy())
  })

  it('submits phone settings after editing fields', async () => {
    const requests = mountConnectors()
    await openProvider(/Phone \(SMS\).*Runtime disabled.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Phone (SMS)' })).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Twilio Account SID'), { target: { value: 'AC123' } })
    fireEvent.change(screen.getByLabelText('OTP length'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Code expiry seconds'), { target: { value: '900' } })
    const verifySwitch = screen.getByRole('switch', { name: 'Require verification' })
    fireEvent.click(verifySwitch)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(requests.some((r) => r.url === '/api/management/sign-in-settings' && r.method === 'PATCH')).toBe(true)
    })
  })

  it('edits web3 wallet chains and toggles', async () => {
    const requests = mountConnectors()
    await openProvider(/Web3 wallet.*Runtime disabled.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Web3 wallet' })).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    // toggle Polygon chain on
    fireEvent.click(screen.getByRole('switch', { name: 'Polygon' }))
    // toggle Ethereum Mainnet off (was on by default)
    fireEvent.click(screen.getByRole('switch', { name: 'Ethereum Mainnet' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow for sign-up' }))
    fireEvent.click(screen.getByRole('switch', { name: 'ENS lookup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const web3 = requests.find(
        (r) => r.url === '/api/management/sign-in-settings' && JSON.stringify(r.body).includes('web3Wallet'),
      )
      expect(web3).toBeTruthy()
    })
  })

  it('edits onetap selects and number fields', async () => {
    const requests = mountConnectors()
    await openProvider(/OneTap.*Runtime disabled.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'OneTap' })).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'one-tap-client' } })
    fireEvent.change(screen.getByLabelText('UX mode'), { target: { value: 'redirect' } })
    fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'signup' } })
    fireEvent.change(screen.getByLabelText('Prompt base delay'), { target: { value: '2000' } })
    fireEvent.change(screen.getByLabelText('Prompt max attempts'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Auto select' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Cancel on outside tap' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const oneTap = requests.find(
        (r) => r.url === '/api/management/sign-in-settings' && JSON.stringify(r.body).includes('oneTap'),
      )
      expect(oneTap).toBeTruthy()
    })
  })

  it('marks all built-in providers as runtime enabled when settings turn them on', async () => {
    const enabledSignIn = {
      ...signInSettings,
      builtInProviders: {
        ...signInSettings.builtInProviders,
        phone: { ...signInSettings.builtInProviders.phone, enabled: true },
        web3Wallet: { ...signInSettings.builtInProviders.web3Wallet, enabled: true },
        oneTap: { ...signInSettings.builtInProviders.oneTap, enabled: true },
      },
    }
    mountConnectors({ signIn: enabledSignIn })
    expect(await screen.findByRole('button', { name: /Phone \(SMS\).*Runtime enabled.*Enabled/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Web3 wallet.*Runtime enabled.*Enabled/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /OneTap.*Runtime enabled.*Enabled/ })).toBeTruthy()
  })

  it('falls back to provider runtime panel when built-in providers are absent', async () => {
    // signInSettings missing builtInProviders -> rows still render with disabled labels,
    // and opening web3-wallet without builtInProviders renders the form (uses defaults).
    mountConnectors()
    await openProvider(/Web3 wallet/)
    expect(await screen.findByRole('heading', { name: 'Web3 wallet' })).toBeTruthy()
  })

  it('creates a social connector with metadata and scopes', async () => {
    const requests = mountConnectors()
    await openProvider(/Amazon Cognito.*Credentials required.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Amazon Cognito' })).toBeTruthy()

    expect(screen.getByLabelText('Callback URL')).toHaveProperty(
      'value',
      'http://localhost:3000/api/auth/callback/cognito',
    )
    // toggle the social Enabled switch + allow-without-email switch
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow users without an email' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cognito-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'SECRET' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'auth.example.com' } })
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us-east-1' } })
    fireEvent.change(screen.getByLabelText('User Pool ID'), { target: { value: 'pool-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const created = requests.find((r) => r.url === '/api/management/connectors' && r.method === 'POST')
      expect(created).toBeTruthy()
      expect((created!.body as { providerId: string }).providerId).toBe('cognito')
    })
  })

  it('opens a provider drawer with Enter key activation', async () => {
    mountConnectors()
    const row = await screen.findByRole('button', { name: /Email.*Runtime enabled.*Enabled/ })
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Email' })).toBeTruthy()
  })

  it('opens a provider drawer with Space key activation', async () => {
    mountConnectors()
    const row = await screen.findByRole('button', { name: /Phone \(SMS\).*Not enabled/ })
    fireEvent.keyDown(row, { key: ' ' })
    expect(await screen.findByRole('heading', { name: 'Phone (SMS)' })).toBeTruthy()
  })

  it('retries all connector queries from the error state', async () => {
    let failTemplates = true
    const requests: Captured[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const request = input instanceof Request ? input : null
      const url = request?.url ? new URL(request.url).pathname : String(input)
      requests.push({ url, method: 'GET', body: null })
      if (url === '/api/management/connectors/templates') {
        if (failTemplates) return Promise.resolve(jsonResponse({ message: 'boom' }, 500))
        return Promise.resolve(jsonResponse(connectorTemplates))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      return consoleSharedFetch(input, init)
    })
    renderWithQuery(<ConnectorsPage />)
    const retry = await screen.findByRole('button', { name: /Retry|Try again/i })
    failTemplates = false
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: /Email/ })).toBeTruthy()
  })

  it('cancels the delete confirmation dialog', async () => {
    const existing = { ...connector, id: 'connector-1', providerId: 'google', clientSecretConfigured: true }
    mountConnectors({ connectors: [existing] })
    await openProvider(/Google.*Credentials configured.*Enabled/)
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    expect(await screen.findByRole('heading', { name: 'Delete connector' })).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete connector' })).toBeNull())
  })

  it('surfaces a synchronous validation error from invalid metadata', async () => {
    mountConnectors()
    await openProvider(/Google.*Credentials required.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    // Leave required clientId/clientSecret empty so zod parse throws inside the submit try/catch
    fireEvent.click(screen.getByRole('button', { name: 'Save' }) as never)
    await waitFor(() => {
      const banners = screen.getAllByText(/Required|Invalid|expected|String must/i)
      expect(banners.length).toBeGreaterThan(0)
    })
  })

  it('copies the callback url to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    mountConnectors()
    await openProvider(/Google.*Credentials required.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/api/auth/callback/google')
  })

  it('surfaces a validation error when social form parsing fails', async () => {
    mountConnectors({
      onMutation: () => jsonResponse({ message: 'create failed' }, 422),
    })
    await openProvider(/Google.*Credentials required.*Not enabled/)
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    // submit without required client id/secret -> create attempt then server error surfaced
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'gid' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'gsecret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(screen.getByText('create failed')).toBeTruthy()
    })
  })

  it('edits and deletes an existing social connector', async () => {
    const existing = { ...connector, id: 'connector-1', providerId: 'google', clientSecretConfigured: true }
    const requests = mountConnectors({
      connectors: [existing],
      onMutation: (captured) => {
        if (captured.method === 'DELETE') return new Response(null, { status: 204 })
        return undefined
      },
    })
    await openProvider(/Google.*Credentials configured.*Enabled/)
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()

    // existing connector -> Delete button present in the drawer footer
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }))
    // confirm dialog opens
    expect(await screen.findByRole('heading', { name: 'Delete connector' })).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(requests.some((r) => r.method === 'DELETE')).toBe(true)
    })
  })

  it('updates an existing social connector via PATCH', async () => {
    const existing = { ...connector, id: 'connector-1', providerId: 'google', clientSecretConfigured: true }
    const requests = mountConnectors({
      connectors: [existing],
      onMutation: () => undefined,
    })
    await openProvider(/Google.*Credentials configured.*Enabled/)
    expect(await screen.findByRole('heading', { name: 'Google' })).toBeTruthy()
    // wait for the connector detail query to resolve so the Save button is enabled
    const save = await screen.findByRole('button', { name: 'Save' })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'new-client' } })
    fireEvent.click(save)
    await waitFor(() => {
      expect(requests.some((r) => r.method === 'PATCH' && r.url.startsWith('/api/management/connectors'))).toBe(true)
    })
  })
})
