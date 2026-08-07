import { cleanup, screen } from '@testing-library/react'
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
  it('uses default settings and a null active Organization for sparse optional configuration', async () => {
    server.use(
      http.get(`${base}/api/configz`, () => HttpResponse.json({})),
      http.get(`${base}/api/account/organization-context`, () => HttpResponse.json({})),
    )
    renderWithClient(
      <AccountSurface section="overview">
        {(profile, access, activeOrganizationId) => (
          <p>{`${profile.email}|${access.platformOperator}|${String(activeOrganizationId)}`}</p>
        )}
      </AccountSurface>,
    )
    expect(await screen.findByText('jane@example.com|false|null')).toBeTruthy()
  })

  it('surfaces query failures through the shared account error boundary', async () => {
    server.use(
      http.get(`${base}/api/account/organization-context`, () =>
        HttpResponse.json({ error: 'Organization context unavailable.' }, { status: 503 }),
      ),
    )
    renderWithClient(<AccountSurface section="overview">{() => <p>Loaded</p>}</AccountSurface>)
    expect(await screen.findByText('Organization context unavailable.')).toBeTruthy()
    expect(screen.queryByText('Loaded')).toBeNull()
  })

  it('rejects missing profile and developer access payloads', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: null })))
    const missingProfile = renderWithClient(<AccountSurface section="overview">{() => <p>Loaded</p>}</AccountSurface>)
    expect(await screen.findByText('Unable to load account center.')).toBeTruthy()
    missingProfile.unmount()

    server.resetHandlers()
    server.use(http.get(`${base}/api/account/developer-console-access`, () => HttpResponse.json(null)))
    renderWithClient(<AccountSurface section="overview">{() => <p>Loaded</p>}</AccountSurface>)
    expect(await screen.findByText('Unable to load account center.')).toBeTruthy()
  })
})
