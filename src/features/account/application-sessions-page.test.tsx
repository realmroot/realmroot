import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { ApplicationSessionsPage } from './application-sessions-page'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}))
const server = createAccountServer(createAccountStore())
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
const item = {
  id: 'session-1',
  createdAt: '2026-09-07T00:00:00.000Z',
  lastActiveAt: '2026-09-07T01:00:00.000Z',
  userAgent: null,
  legacy: false,
}
function collection(items = [item]) {
  return {
    application: { name: 'Example App', clientId: 'example' },
    items,
    pagination: { page: 1, pageSize: 20, totalItems: items.length, totalPages: items.length ? 1 : 0 },
  }
}

describe('Hosted application session feedback', () => {
  it('shows the browser account, unknown client information, and a retryable load failure', async () => {
    let fail = true
    server.use(
      http.get(`${base}/api/account/application-sessions`, () =>
        fail
          ? HttpResponse.json({ error: { message: 'Session service unavailable' } }, { status: 503 })
          : HttpResponse.json(collection()),
      ),
    )
    renderWithClient(<ApplicationSessionsPage clientId="example" />)
    expect(await screen.findByText('Session service unavailable')).toBeTruthy()
    expect(screen.getAllByText('jane@example.com')[0]).toBeTruthy()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Client information unavailable')).toBeTruthy()
    expect(screen.getByText('1 active login session')).toBeTruthy()
    expect(screen.queryByText('Current')).toBeNull()
  })

  it('keeps a failed removal in the confirmation and reconciles the list after retry', async () => {
    let fail = true
    let removed = false
    server.use(
      http.get(`${base}/api/account/application-sessions`, () => HttpResponse.json(collection(removed ? [] : [item]))),
      http.delete(`${base}/api/account/application-sessions/:id`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('client_id')).toBe('example')
        if (fail) return HttpResponse.json({ error: { message: 'Removal unavailable' } }, { status: 503 })
        removed = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderWithClient(<ApplicationSessionsPage clientId="example" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove session' }))
    const dialog = screen.getByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove session' }))
    expect(await within(dialog).findByText('Removal unavailable')).toBeTruthy()
    expect(screen.getByText('1 active login session')).toBeTruthy()
    fail = false
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove session' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(await screen.findByText('No active login sessions')).toBeTruthy()
    expect(screen.getByText('0 active login sessions')).toBeTruthy()
  })

  it('does not fetch a collection when the application selector is absent', async () => {
    renderWithClient(<ApplicationSessionsPage clientId="" />)
    expect(await screen.findByText('Open this page from an application with a client_id.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove session' })).toBeNull()
  })
})
