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
    expect(screen.getAllByRole('heading', { name: 'Delegated agents' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Web3 wallet')).toBeTruthy()
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

  it('revokes a delegated agent and a capability grant', async () => {
    const withAgent = createAccountStore()
    withAgent.agents = [
      {
        id: 'agent-1',
        name: 'Helper Bot',
        status: 'active',
        host: { id: 'host-1', name: 'Workstation' },
        capabilityGrants: [{ id: 'grant-1', capability: 'read:profile' }],
      },
    ]
    Object.assign(store, withAgent)
    server.use(
      http.delete(`${base}/api/account/agents/:agentId`, () => {
        store.agents = []
        return HttpResponse.json({ ok: true })
      }),
      http.delete(`${base}/api/account/agent-capability-grants/:grantId`, () => {
        store.agents[0].capabilityGrants = []
        return HttpResponse.json({ ok: true })
      }),
    )
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Helper Bot')).toBeTruthy()
    expect(screen.getByText('read:profile')).toBeTruthy()

    const agentRow = screen.getByText('Helper Bot').closest('article') as HTMLElement
    const agentButtons = agentRow.querySelectorAll('button')
    fireEvent.click(agentButtons[agentButtons.length - 1])
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Agent access revoked.'))
    await waitFor(() => expect(screen.queryByText('Helper Bot')).toBeNull())
  })

  it('revokes an agent capability grant', async () => {
    const withAgent = createAccountStore()
    withAgent.agents = [
      {
        id: 'agent-3',
        name: 'Grant Bot',
        status: 'active',
        host: { id: 'host-3', name: 'Box' },
        capabilityGrants: [{ id: 'grant-9', capability: 'read:email' }],
      },
    ]
    Object.assign(store, withAgent)
    server.use(
      http.delete(`${base}/api/account/agent-capability-grants/:grantId`, () => {
        store.agents[0].capabilityGrants = []
        return HttpResponse.json({ ok: true })
      }),
    )
    renderWithClient(<AccountConnectionsPage />)
    const grantRow = (await screen.findByText('read:email')).closest('div') as HTMLElement
    fireEvent.click(grantRow.querySelector('button') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke grant' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Capability grant revoked.'))
  })

  it('renders an agent host id and None capabilities fallback', async () => {
    const withAgent = createAccountStore()
    withAgent.agents = [
      { id: 'agent-2', name: 'Bare Bot', status: 'pending', host: { id: 'host-2', name: null }, capabilityGrants: [] },
    ]
    Object.assign(store, withAgent)
    renderWithClient(<AccountConnectionsPage />)
    expect(await screen.findByText('Bare Bot')).toBeTruthy()
    expect(screen.getByText(/host-2/)).toBeTruthy()
    expect(screen.getByText(/None/)).toBeTruthy()
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
      http.post(`${base}/api/auth/siwe/nonce`, () => HttpResponse.json({ nonce: 'nonce12345' })),
      http.post(`${base}/api/account/wallet-addresses`, () => HttpResponse.json({ id: 'wallet-1' })),
    )
    renderWithClient(<AccountConnectionsPage />)
    const walletRow = (await screen.findByText('Web3 wallet')).closest('article') as HTMLElement
    fireEvent.click(walletRow.querySelector('button') as HTMLElement)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Wallet linked.'))
  })

  it('still renders the panels when connected accounts queries are disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, connectedAccountsEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountConnectionsPage />)
    expect((await screen.findAllByRole('heading', { name: 'Delegated agents' })).length).toBeGreaterThan(0)
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
    expect(screen.getByText('No delegated agents yet.')).toBeTruthy()
  })
})
