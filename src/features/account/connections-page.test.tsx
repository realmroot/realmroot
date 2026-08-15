import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  base,
  createAccountServer,
  createAccountStore,
  HttpResponse,
  http,
  renderWithClient,
} from './account.test-utils'
import { AccountConnectionsPage } from './connections-page'

const success = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => success(...args), error: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const store = createAccountStore()
const server = createAccountServer(store)
const pagination = { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null }
const githubConnector = {
  id: 'connector-github',
  slug: 'github',
  providerType: 'social',
  providerId: 'github',
  displayName: 'GitHub',
  capabilities: {
    signIn: { available: true },
    agentAccess: { available: true, resourceCount: 1 },
    connection: { method: 'provider_authorization' as const },
  },
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  success.mockClear()
  vi.unstubAllGlobals()
})
afterAll(() => server.close())

describe('AccountConnectionsPage', () => {
  it('[spec: account-center/provider-connections] presents one Provider Connection with both capabilities', async () => {
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-github',
              connector: githubConnector,
              externalSubject: 'octocat',
              displayName: 'The Octocat',
              status: 'active',
              capabilities: {
                signIn: { available: true, active: true },
                agentAccess: {
                  available: true,
                  active: true,
                  authorizationCount: 1,
                  resourceNames: ['GitHub Adapter'],
                },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination,
        }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('GitHub')).toBeTruthy()
    expect(screen.getByText(/^The Octocat · Connected /).closest('.providerLabel')).toBeTruthy()
    expect(screen.getByText('Sign-in')).toBeTruthy()
    expect(screen.getByText('Agent resource access')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    expect(await screen.findByRole('heading', { name: 'GitHub' })).toBeTruthy()
    expect(screen.getAllByText('octocat')).toHaveLength(2)
    expect(screen.getByText('GitHub Adapter')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Link sign-in' })).toBeNull()
  })

  it('[spec: account-center/provider-connections] starts an available Provider authorization flow', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.post(`${base}/api/account/provider-connection-intents`, () =>
        HttpResponse.json(
          {
            id: 'provider-intent-github',
            connectorId: githubConnector.id,
            authorizationUrl: 'https://github.com/apps/realmroot/installations/new',
            expiresAt: '2026-08-08T00:10:00.000Z',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect((await screen.findByText('Sign-in and Agent resource access')).closest('.providerLabel')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/realmroot/installations/new'))
  })

  it('[spec: account-center/provider-connections] updates authorization for an existing Provider Connection', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-github',
              connector: githubConnector,
              externalSubject: 'octocat',
              displayName: 'The Octocat',
              capabilities: {
                signIn: { available: true, active: true },
                agentAccess: {
                  available: true,
                  active: true,
                  authorizationCount: 1,
                  resourceNames: ['GitHub Adapter'],
                },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination,
        }),
      ),
      http.post(`${base}/api/account/provider-connection-intents`, async ({ request }) => {
        expect(await request.json()).toEqual({ connectorId: githubConnector.id })
        return HttpResponse.json(
          {
            id: 'provider-intent-github-reauthorize',
            connectorId: githubConnector.id,
            authorizationUrl: 'https://github.com/login/oauth/authorize?reauthorize=true',
            expiresAt: '2026-08-08T00:10:00.000Z',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
          { status: 201 },
        )
      }),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Update authorization' }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?reauthorize=true'),
    )
  })

  it('[spec: account-center/provider-connection-sign-in-linking] links sign-in to an existing Provider Connection', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    let linkedBody: unknown
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-github',
              connector: githubConnector,
              externalSubject: 'octocat',
              displayName: 'The Octocat',
              capabilities: {
                signIn: { available: true, active: false },
                agentAccess: {
                  available: true,
                  active: true,
                  authorizationCount: 1,
                  resourceNames: ['GitHub Adapter'],
                },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination,
        }),
      ),
      http.post(`${base}/api/auth/link-social`, async ({ request }) => {
        linkedBody = await request.json()
        return HttpResponse.json({ url: 'https://github.com/login/oauth' })
      }),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Link sign-in' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth'))
    expect(linkedBody).toMatchObject({
      provider: 'github',
      callbackURL: 'http://localhost:3000/connections',
    })
  })

  it('stays on the page when a Provider authorization intent cannot be created', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.post(`${base}/api/account/provider-connection-intents`, () =>
        HttpResponse.json({ message: 'Provider authorization unavailable.' }, { status: 503 }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(assign).not.toHaveBeenCalled())
  })

  it('offers direct connection for an Agent-only Provider', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({
          items: [
            {
              ...githubConnector,
              capabilities: {
                signIn: { available: false },
                agentAccess: { available: true, resourceCount: 1 },
                connection: { method: 'provider_authorization' },
              },
            },
          ],
          pagination,
        }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.post(`${base}/api/account/provider-connection-intents`, () =>
        HttpResponse.json(
          {
            id: 'provider-intent-github',
            connectorId: githubConnector.id,
            authorizationUrl: 'https://github.com/apps/realmroot/installations/new',
            expiresAt: '2026-08-08T00:10:00.000Z',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect((await screen.findByText('Agent resource access only')).closest('.providerLabel')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/realmroot/installations/new'))
  })

  it('uses the Connector sign-in flow when no Provider authorization authority exists', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    let linkedBody: unknown
    const signInConnector = {
      ...githubConnector,
      providerType: 'generic_oauth',
      capabilities: {
        signIn: { available: true },
        agentAccess: { available: false },
        connection: { method: 'sign_in' as const },
      },
    }
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [signInConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.post(`${base}/api/auth/oauth2/link`, async ({ request }) => {
        linkedBody = await request.json()
        return HttpResponse.json({ url: 'https://provider.example.com/authorize' })
      }),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Sign-in only')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://provider.example.com/authorize'))
    expect(linkedBody).toMatchObject({
      providerId: 'github',
      callbackURL: 'http://localhost:3000/connections',
    })
  })

  it('uses social account linking for a social sign-in Connector', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    const socialConnector = {
      ...githubConnector,
      capabilities: {
        signIn: { available: true },
        agentAccess: { available: false },
        connection: { method: 'sign_in' as const },
      },
    }
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [socialConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.post(`${base}/api/auth/link-social`, () => HttpResponse.json({ url: 'https://github.com/login/oauth' })),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth'))
  })

  it('stays on the page when account linking returns no redirect URL', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    const socialConnector = {
      ...githubConnector,
      capabilities: {
        signIn: { available: true },
        agentAccess: { available: false },
        connection: { method: 'sign_in' as const },
      },
    }
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [socialConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
      http.post(`${base}/api/auth/link-social`, () => HttpResponse.json({})),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(assign).not.toHaveBeenCalled())
  })

  it('renders unavailable and empty Provider states without a connection action', async () => {
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({
          items: [
            {
              ...githubConnector,
              capabilities: {
                signIn: { available: false },
                agentAccess: { available: false },
                connection: { method: null },
              },
            },
          ],
          pagination,
        }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({ items: [], pagination: { ...pagination, total: 0 } }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('No available capabilities')).toBeTruthy()
    expect(screen.getByText('No Provider Connections')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('shows a connection that needs attention and has no Agent resources', async () => {
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-github',
              connector: githubConnector,
              externalSubject: 'octocat',
              displayName: 'The Octocat',
              capabilities: {
                signIn: { available: true, active: false },
                agentAccess: { available: true, active: false, authorizationCount: 0, resourceNames: [] },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination,
        }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Needs attention')).toBeTruthy()
    expect(screen.getByText('All Providers connected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    expect(await screen.findByText('No Agent resource access')).toBeTruthy()
    expect(screen.getAllByText('Not enabled')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[1]!)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'GitHub' })).toBeNull())
  })

  it('disconnects the whole Provider Connection', async () => {
    let disconnected = false
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-github',
              connector: githubConnector,
              externalSubject: 'octocat',
              displayName: 'The Octocat',
              status: 'active',
              capabilities: {
                signIn: { available: true, active: false },
                agentAccess: {
                  available: true,
                  active: true,
                  authorizationCount: 1,
                  resourceNames: ['GitHub Adapter'],
                },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination,
        }),
      ),
      http.delete(`${base}/api/account/provider-connections/provider-connection-github`, () => {
        disconnected = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Provider' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(disconnected).toBe(true))
    expect(success).toHaveBeenCalledWith('GitHub disconnected.')
  })

  it('keeps the Provider sheet open when disconnection fails', async () => {
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ items: [githubConnector], pagination }),
      ),
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-github',
              connector: githubConnector,
              externalSubject: 'octocat',
              displayName: 'The Octocat',
              capabilities: {
                signIn: { available: true, active: false },
                agentAccess: { available: true, active: true, authorizationCount: 1, resourceNames: [] },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination,
        }),
      ),
      http.delete(`${base}/api/account/provider-connections/provider-connection-github`, () =>
        HttpResponse.json({ message: 'Revocation unavailable.' }, { status: 502 }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Provider' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByRole('heading', { name: 'GitHub' })).toBeTruthy()
  })

  it('renders a Provider Connection error state', async () => {
    server.use(
      http.get(`${base}/api/account/provider-connectors`, () =>
        HttpResponse.json({ message: 'Providers unavailable.' }, { status: 500 }),
      ),
    )
    renderWithClient(<AccountConnectionsPage />)
    expect((await screen.findByRole('alert')).textContent).toBe('Providers unavailable.')
  })
})
