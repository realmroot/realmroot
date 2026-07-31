import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  base,
  configz,
  createAccountServer,
  createAccountStore,
  HttpResponse,
  http,
  renderWithClient,
} from './account.test-utils'
import { AccountConnectionsPage } from './connections-page'

const success = vi.fn()
const errorToast = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => errorToast(...a) },
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

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  success.mockClear()
  errorToast.mockClear()
  Object.assign(store, createAccountStore())
  vi.unstubAllGlobals()
})
afterAll(() => server.close())

describe('AccountConnectionsPage', () => {
  it('renders connectors, authorized apps, and agents panels', async () => {
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('GitHub')).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: 'Authorized apps' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('heading', { name: 'Agent identities' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Web3 wallet')).toBeTruthy()
  })

  it('does not start an unscoped external API connection from the account page', async () => {
    server.use(
      http.get(`${base}/api/account/api-resources`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'resource-1',
              identifier: 'projects',
              name: 'Projects API',
              resourceUrl: 'https://projects.example.com/api',
              scopes: [{ value: 'projects:read', description: 'Read projects' }],
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('No connected resource accounts.')).toBeTruthy()
    expect(screen.queryByText('Projects API')).toBeNull()
    expect(
      screen.getByText(
        'Approve an Agent resource access request to connect this account through its scoped OAuth flow.',
      ),
    ).toBeTruthy()
  })

  it('disconnects an active external API resource account', async () => {
    server.use(
      http.get(`${base}/api/account/api-resources`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'resource-1',
              identifier: 'projects',
              name: 'Projects API',
              resourceUrl: 'https://projects.example.com/api',
              scopes: [{ value: 'projects:read', description: null }],
            },
          ],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
      ),
      http.get(`${base}/api/account/account-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'connection-1',
              apiResourceId: 'resource-1',
              owner: { type: 'user', userId: 'user-1' },
              displayName: 'Project Owner',
              subjectHint: '••••er-1',
              scopes: ['projects:read'],
              status: 'active',
              credentialExpiresAt: null,
              authorizationUrl: null,
              expiresAt: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
            {
              id: 'connection-unknown',
              apiResourceId: 'missing-resource',
              owner: { type: 'user', userId: 'user-1' },
              displayName: 'Unknown owner',
              subjectHint: '••••nown',
              scopes: [],
              status: 'active',
              credentialExpiresAt: '2026-08-01T01:00:00.000Z',
              authorizationUrl: null,
              expiresAt: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
            {
              id: 'connection-revoked',
              apiResourceId: 'resource-1',
              owner: { type: 'user', userId: 'user-1' },
              displayName: 'Revoked owner',
              subjectHint: '••••oked',
              scopes: ['projects:read'],
              status: 'revoked',
              credentialExpiresAt: null,
              authorizationUrl: null,
              expiresAt: null,
              createdAt: '2026-08-01T00:00:00.000Z',
              updatedAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          pagination: { limit: 50, offset: 0, total: 3, hasMore: false, nextOffset: null },
        }),
      ),
      http.delete(
        `${base}/api/account/account-connections/:connectionId`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    )

    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('API resource · Unknown owner')).toBeTruthy()
    expect(screen.queryByText('Revoked owner')).toBeNull()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Disconnect' }))[0]!)
    const disconnectButtons = await screen.findAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(disconnectButtons.at(-1)!)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Resource account disconnected.'))
  })

  it('presents personal stable Agent identities in Account Center', async () => {
    const withIdentity = createAccountStore()
    withIdentity.agentIdentities = [
      {
        id: 'identity-1',
        issuer: 'https://auth.example.com',
        subject: 'agt_stable',
        name: 'Personal Build Agent',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'active',
        retiredAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        bindings: [],
      },
      {
        id: 'identity-retired',
        issuer: 'https://auth.example.com',
        subject: 'agt_retired',
        name: 'Retired Agent',
        homeSpace: { type: 'personal', userId: 'user-1' },
        status: 'retired',
        retiredAt: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        bindings: [],
      },
    ]
    Object.assign(store, withIdentity)
    server.use(http.delete(`${base}/api/account/agents/:agentId`, () => new HttpResponse(null, { status: 204 })))

    renderWithClient(<AccountConnectionsPage />)

    expect(await screen.findByText('Personal Build Agent')).toBeTruthy()
    expect(screen.getByText('Retired Agent')).toBeTruthy()
    expect(screen.getByText(/https:\/\/auth\.example\.com · agt_stable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retire identity' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Agent retired.'))
  })

  it('renders an error state when a connections request fails', async () => {
    server.use(
      http.get(`${base}/api/account/linked-accounts`, () => HttpResponse.json({ error: 'fail' }, { status: 500 })),
    )
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('fail')).toBeTruthy()
  })

  it('connects a social provider and redirects to its URL', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    server.use(http.post(`${base}/api/auth/link-social`, () => HttpResponse.json({ url: '/social-redirect' })))
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('GitHub')).toBeTruthy()
    const githubRow = screen.getByText('GitHub').closest('article') as HTMLElement
    fireEvent.click(githubRow.querySelector('button') as HTMLElement)
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/social-redirect'))
  })

  it('connects a generic oauth provider and ignores a missing redirect', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, origin: 'http://localhost:3000', assign })
    const oauthConfig = configz()
    oauthConfig.identityProviders = [
      { slug: 'okta', providerType: 'generic_oauth', providerId: 'okta', displayName: 'Okta', icon: 'okta' },
    ]
    server.use(
      http.get(`${base}/api/configz`, () => HttpResponse.json(oauthConfig)),
      http.post(`${base}/api/auth/oauth2/link`, () => HttpResponse.json({})),
    )
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Okta')).toBeTruthy()
    const oktaRow = screen.getByText('Okta').closest('article') as HTMLElement
    fireEvent.click(oktaRow.querySelector('button') as HTMLElement)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Redirecting to Okta.'))
    expect(assign).not.toHaveBeenCalled()
  })

  it('unlinks a connected provider', async () => {
    const linked = createAccountStore()
    linked.linkedAccounts = [
      { id: 'la-1', accountId: 'acct-1', providerId: 'github', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    Object.assign(store, linked)
    server.use(http.delete(`${base}/api/account/linked-accounts/:providerId`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Linked')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink account' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Linked account removed.'))
  })

  it('shows the empty connectors state when no providers are configured', async () => {
    const noProviders = configz()
    noProviders.identityProviders = []
    noProviders.builtInProviders = {
      ...noProviders.builtInProviders,
      web3Wallet: { ...noProviders.builtInProviders.web3Wallet, enabled: false },
    }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(noProviders)))
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('No sign-in connectors are available.')).toBeTruthy()
  })

  it('unlinks a linked wallet', async () => {
    const withWallet = createAccountStore()
    withWallet.linkedAccounts = [
      { id: 'w-1', accountId: 'wallet-acct', providerId: 'siwe', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    Object.assign(store, withWallet)
    server.use(http.delete(`${base}/api/account/wallet-addresses/:accountId`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('1 wallet linked.')).toBeTruthy()
    const walletRow = screen.getByText('Web3 wallet').closest('article') as HTMLElement
    fireEvent.click(walletRow.querySelector('button') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink wallet' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Wallet removed.'))
  })

  it('revokes an authorized application', async () => {
    const withApp = createAccountStore()
    withApp.applications = [
      { id: 'app-1', applicationName: 'Portal', scopes: ['openid', 'email'], grantedAt: '2026-01-01T00:00:00.000Z' },
    ]
    Object.assign(store, withApp)
    server.use(http.delete(`${base}/api/account/applications/:consentId`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Portal')).toBeTruthy()
    const appRow = screen.getByText('Portal').closest('article') as HTMLElement
    fireEvent.click(appRow.querySelector('button') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Application access revoked.'))
  })

  it('connects a wallet through the enroll flow', async () => {
    vi.stubGlobal(
      'window',
      Object.assign(window, {
        ethereum: {
          request: vi.fn(async ({ method }: { method: string }) => {
            if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111']
            if (method === 'eth_chainId') return '0x1'
            if (method === 'personal_sign') return '0xsignature'
            return null
          }),
        },
      }),
    )
    server.use(
      http.get(`${base}/api/configz`, () => {
        const walletConfig = configz()
        walletConfig.builtInProviders.web3Wallet = {
          ...walletConfig.builtInProviders.web3Wallet,
          chains: undefined as unknown as number[],
        }
        return HttpResponse.json(walletConfig)
      }),
      http.post(`${base}/api/auth/siwe/nonce`, () => HttpResponse.json({ nonce: 'nonce12345' })),
      http.post(`${base}/api/account/wallet-addresses`, () => HttpResponse.json({ id: 'wallet-1' })),
    )
    renderWithClient(<AccountConnectionsPage />)
    const walletRow = (await screen.findByText('Web3 wallet')).closest('article') as HTMLElement
    fireEvent.click(walletRow.querySelector('button') as HTMLElement)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Wallet linked.'))
  })

  it('shows an account-center error when the profile is absent', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: null })))
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Unable to load account center.')).toBeTruthy()
  })

  it('still renders the panels when connected accounts queries are disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, connectedAccountsEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountConnectionsPage />)
    expect((await screen.findAllByRole('heading', { name: 'Agent identities' })).length).toBeGreaterThan(0)
  })

  it('shows the generic error message when a query rejects with a non-Error', async () => {
    const mswFetch = window.fetch
    const fetchSpy = vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input).endsWith('/api/account/agents')) return Promise.reject('string failure')
      return mswFetch(input, init)
    })
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Unable to load.')).toBeTruthy()
    fetchSpy.mockRestore()
  })

  it('falls back to empty collections when responses omit their keys', async () => {
    server.use(
      http.get(`${base}/api/account/linked-accounts`, () => HttpResponse.json({})),
      http.get(`${base}/api/account/applications`, () => HttpResponse.json({})),
      http.get(`${base}/api/account/agents`, () => HttpResponse.json({})),
    )
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('No authorized applications yet.')).toBeTruthy()
    expect(screen.getByText('No Agent identities yet.')).toBeTruthy()
  })
})
