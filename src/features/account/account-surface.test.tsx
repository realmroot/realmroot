import { cleanup, screen, waitFor } from '@testing-library/react'
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
import { AccountSurface } from './account-surface'
import { accountQueryKeys } from './queries'

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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  Object.assign(store, createAccountStore())
})
afterAll(() => server.close())

describe('AccountSurface', () => {
  it('uses default settings for sparse optional configuration', async () => {
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json({})))
    renderWithClient(
      <AccountSurface>{(profile, access) => <p>{`${profile.email}|${access.platformOperator}`}</p>}</AccountSurface>,
    )
    expect(await screen.findByText('jane@example.com|false')).toBeTruthy()
  })

  it('keeps the shared shell mounted when cached account data fails to refresh', async () => {
    const { queryClient } = renderWithClient(<AccountSurface>{() => <p>Loaded</p>}</AccountSurface>)
    expect(await screen.findByText('Loaded')).toBeTruthy()
    const shell = document.querySelector('.accountShell')
    server.use(
      http.get(`${base}/api/account/profile`, () =>
        HttpResponse.json({ error: 'Profile refresh unavailable.' }, { status: 503 }),
      ),
    )

    await queryClient.invalidateQueries({ queryKey: accountQueryKeys.profile })

    await waitFor(() => expect(screen.getByText('Profile refresh unavailable.')).toBeTruthy())
    expect(document.querySelector('.accountShell')).toBe(shell)
    expect(screen.getByText('Loaded')).toBeTruthy()
  })

  it('rejects missing profile and developer access payloads', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: null })))
    const missingProfile = renderWithClient(<AccountSurface>{() => <p>Loaded</p>}</AccountSurface>)
    expect(await screen.findByText('Unable to load account center.')).toBeTruthy()
    missingProfile.unmount()

    server.resetHandlers()
    server.use(http.get(`${base}/api/account/developer-console-access`, () => HttpResponse.json(null)))
    renderWithClient(<AccountSurface>{() => <p>Loaded</p>}</AccountSurface>)
    expect(await screen.findByText('Unable to load account center.')).toBeTruthy()
  })
})
