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

function oidcConnector(overrides: Record<string, unknown> = {}) {
  return {
    ...connector,
    id: 'connector-oidc',
    slug: 'projects',
    providerType: 'generic_oauth' as const,
    providerId: 'projects',
    displayName: 'Projects OIDC',
    enabled: false,
    authenticationEnabled: true,
    clientSecretConfigured: false,
    issuer: 'https://idp.example.com',
    registrationMode: 'manual' as const,
    ...overrides,
  }
}

function emptyConnectorFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url === '/api/connectors')
    return Promise.resolve(jsonResponse({ items: [], pagination: { ...pagination, totalItems: 0 } }))
  if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
  if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(signInSettings))
  if (url === '/api/realm/security-policy') return Promise.resolve(jsonResponse(securityPolicy))
  return consoleSharedFetch(input, init)
}

async function openOidcTab() {
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'OIDC connectors' }), { button: 0, ctrlKey: false })
}

describe('admin console Identity providers', () => {
  it('creates a reusable manual OIDC connector [spec: admin-console/admin-oidc-connector-inventory]', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/connectors' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(oidcConnector({ enabled: true }), 201))
      }
      return emptyConnectorFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    await openOidcTab()
    expect(await screen.findByText('No OIDC connectors yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add OIDC connector' }))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Projects OIDC' } })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'projects' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Allow hosted login' }))
    fireEvent.change(screen.getByLabelText('OIDC issuer'), { target: { value: 'https://idp.example.com' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-1' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'secret-1' } })
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'openid profile' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          slug: 'projects',
          providerId: 'projects',
          providerType: 'generic_oauth',
          displayName: 'Projects OIDC',
          issuer: 'https://idp.example.com',
          registrationMode: 'manual',
          clientId: 'client-1',
          clientSecret: 'secret-1',
          enabled: true,
          authenticationEnabled: true,
          scopes: ['openid', 'profile'],
        }),
      ]),
    )
  })

  it('creates an OIDC connector with dynamic registration', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/connectors' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(oidcConnector({ registrationMode: 'dynamic' }), 201))
      }
      return emptyConnectorFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    await openOidcTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Add OIDC connector' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dynamic OIDC' } })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'dynamic-oidc' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Allow hosted login' }))
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

  it('creates one OIDC connector for hosted login and managed resource authorization', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/connectors' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(oidcConnector({ enabled: true }), 201))
      }
      return emptyConnectorFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    await openOidcTab()
    fireEvent.click(await screen.findByRole('button', { name: 'Add OIDC connector' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dual-purpose provider' } })
    fireEvent.change(screen.getByLabelText('Provider ID'), { target: { value: 'dual-provider' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Allow hosted login' }))
    fireEvent.change(screen.getByLabelText('OIDC issuer'), { target: { value: 'https://login.example.com' } })
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'login-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'login-secret' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Allow resource authorization' }))
    fireEvent.change(screen.getByLabelText('Authorization server issuer'), {
      target: { value: 'https://api.example.com' },
    })
    fireEvent.change(screen.getByLabelText('Resource client ID'), { target: { value: 'resource-client' } })
    fireEvent.change(screen.getByLabelText('Resource client secret'), { target: { value: 'resource-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          providerId: 'dual-provider',
          authenticationEnabled: true,
          resourceAuthorization: {
            enabled: true,
            registrationMode: 'manual',
            issuer: 'https://api.example.com',
            clientId: 'resource-client',
            clientSecret: 'resource-secret',
          },
        }),
      ]),
    )
  })

  it('updates and deletes an existing OIDC connector from its drawer', async () => {
    const selected = oidcConnector({ clientId: 'summary-client' })
    const detail = { ...selected, clientId: 'client-1' }
    const requests: Array<{ method: string; body?: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/connectors/connector-oidc' && init?.method === 'PATCH') {
        requests.push({ method: init.method, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse({ ...selected, enabled: true, authenticationEnabled: false }))
      }
      if (url === '/api/connectors/connector-oidc' && init?.method === 'DELETE') {
        requests.push({ method: init.method })
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      if (url === '/api/connectors/connector-oidc') return Promise.resolve(jsonResponse(detail))
      if (url === '/api/connectors') return Promise.resolve(jsonResponse({ items: [selected], pagination }))
      if (url === '/api/connectors/templates') return Promise.resolve(jsonResponse(connectorTemplates))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    await openOidcTab()
    fireEvent.click((await screen.findByText('Projects OIDC')).closest('tr') as HTMLElement)
    expect(await screen.findByRole('heading', { name: 'Projects OIDC' })).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Client ID')).toHaveProperty('value', 'client-1'))
    expect(screen.getByLabelText('OIDC issuer')).toHaveProperty('readOnly', true)
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-2' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow hosted login' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(requests.some((request) => request.method === 'PATCH')).toBe(true))
    expect(requests.find((request) => request.method === 'PATCH')?.body).toMatchObject({
      enabled: true,
      authenticationEnabled: false,
      clientId: 'client-2',
    })

    fireEvent.click((await screen.findByText('Projects OIDC')).closest('tr') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(requests).toContainEqual({ method: 'DELETE' }))
  })

  it('submits Better Auth provider-specific connector fields [spec: admin-console/admin-create-connector]', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/connectors' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(
          jsonResponse({ ...connector, providerId: 'cognito', displayName: 'Amazon Cognito' }, 201),
        )
      }
      return emptyConnectorFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    fireEvent.click((await screen.findByText('Amazon Cognito')).closest('tr') as HTMLElement)
    expect(await screen.findByRole('heading', { name: 'Amazon Cognito' })).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Enabled' }))
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'cognito-client' } })
    fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'COGNITO_SECRET' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'auth.example.com' } })
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'us-east-1' } })
    fireEvent.change(screen.getByLabelText('User Pool ID'), { target: { value: 'pool-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          providerId: 'cognito',
          providerType: 'social',
          clientId: 'cognito-client',
          clientSecret: 'COGNITO_SECRET',
          providerMetadata: { domain: 'auth.example.com', region: 'us-east-1', userPoolId: 'pool-1' },
        }),
      ]),
    )
  })

  it('keeps one Identity provider information architecture for built-in and OIDC inventories [spec: admin-console/admin-connector-inventory]', async () => {
    const selected = oidcConnector({ enabled: true })
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [connector, selected], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ConnectorsPage />)
    expect(await screen.findByRole('heading', { name: 'Identity providers' })).toBeTruthy()
    expect((await screen.findByRole('tab', { name: 'Builtin connectors' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Email')).toBeTruthy()
    expect(screen.getByText('Google')).toBeTruthy()
    expect(screen.getByText('Google').closest('tr')?.querySelector('.providerIcon img')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Builtin connectors' }).parentElement?.getAttribute('data-variant')).toBe(
      'navigation',
    )
    expect(screen.getByRole('tablist').closest('.consoleResourceFrame')).toBeNull()
    const listPanel = screen.getByRole('table').closest('.consoleDataTablePanel')
    expect(listPanel).toBeTruthy()
    expect(screen.getByLabelText('Search providers').closest('.consoleDataTablePanel')).toBe(listPanel)
    expect(listPanel?.querySelector('.consoleDataTableToolbar')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: 'google' } })
    expect(screen.queryByText('Email')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter provider type'), { target: { value: 'Built-in' } })
    expect(await screen.findByText('No providers found')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter provider type'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter provider status'), { target: { value: 'disabled' } })
    expect(screen.queryByText('Google')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search providers'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter provider status'), { target: { value: '' } })
    await openOidcTab()
    expect(await screen.findByText('Projects OIDC')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add OIDC connector' })).toBeTruthy()
    fireEvent.keyDown((await screen.findByText('Projects OIDC')).closest('tr') as HTMLElement, { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Projects OIDC' })).toBeTruthy()
  })
})
