import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PublicAgentProfilePage, PublicUserProfilePage } from './public-profile-page'

const authState = vi.hoisted(() => ({
  data: null as null | {
    user: { email: string; id: string; image: string | null; name: string; username: string | null }
  },
  error: null,
  isPending: false,
}))
const navigate = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({ ...authState, isRefetching: false, refetch: vi.fn() }),
  },
  signOut,
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    'aria-label': ariaLabel,
    children,
    params,
    to,
  }: {
    'aria-label'?: string
    children: ReactNode
    params?: Record<string, string>
    to: string
  }) => (
    <a
      aria-label={ariaLabel}
      href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}))

const server = setupServer(
  http.get('/api/public/users/jane', () => HttpResponse.json(userProfile)),
  http.get('/api/public/agents/agt_stable', () => HttpResponse.json(agentProfile)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  authState.data = null
  authState.error = null
  authState.isPending = false
  navigate.mockReset()
  signOut.mockReset()
})
afterAll(() => server.close())

describe('Public profile pages', () => {
  it('shows only Public Agents and recent activity on the User profile', async () => {
    renderProfile(<PublicUserProfilePage username="jane" />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Public Agents' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Activity overview' })).toBeNull()
    expect(screen.queryByLabelText('Agent activity heatmap')).toBeNull()
    expect(screen.getByRole('link', { name: /GitHub/ }).getAttribute('href')).toBe('https://github.com/jane')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/auth/sign-in')
  })

  it('shows the shared account menu instead of Sign in to a signed-in visitor [spec: account-center/public-user-profile]', async () => {
    authState.data = {
      user: { email: 'jane@example.com', id: 'user-1', image: null, name: 'Jane Stone', username: 'jane' },
    }

    renderProfile(<PublicUserProfilePage username="jane" />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), { button: 0, ctrlKey: false })
    expect(screen.getByRole('link', { name: 'View public profile for Jane Stone' }).getAttribute('href')).toBe(
      '/u/jane',
    )
    expect((await screen.findByRole('link', { name: 'Account Center' })).getAttribute('href')).toBe('/profile')
    expect(screen.getByText('jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in' }))
  })

  it('does not redirect a signed-in visitor when sign out fails', async () => {
    authState.data = {
      user: { email: 'jane@example.com', id: 'user-1', image: null, name: 'Jane Stone', username: 'jane' },
    }
    signOut.mockRejectedValueOnce(new Error('Sign out failed.'))

    renderProfile(<PublicUserProfilePage username="jane" />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows overview, heatmap, and recent activity on the Agent profile', async () => {
    renderProfile(<PublicAgentProfilePage subject="agt_stable" />)

    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    expect(screen.getByText('Current streak')).toBeTruthy()
    expect(screen.getByLabelText('Agent activity heatmap')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy()
    expect(screen.getByText('Jane Stone')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Jane Stone/ }).getAttribute('href')).toBe('/u/jane')
  })

  it('renders empty User sections without an optional public presence block', async () => {
    server.use(
      http.get('/api/public/users/empty', () =>
        HttpResponse.json({
          ...userProfile,
          username: 'empty',
          bio: null,
          location: null,
          links: [],
          agentCount: 0,
          agents: [],
          recentActivity: [],
        }),
      ),
    )

    renderProfile(<PublicUserProfilePage username="empty" />)

    expect(await screen.findByText('No public Agents yet.')).toBeTruthy()
    expect(screen.getByText('No public activity yet.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Links & identities' })).toBeNull()
  })

  it('renders organization ownership, no current streak, pictures, and every heatmap intensity', async () => {
    const today = new Date().toISOString().slice(0, 10)
    server.use(
      http.get('/api/public/agents/agt_org', () =>
        HttpResponse.json({
          ...agentProfile,
          subject: 'agt_org',
          picture: 'https://identity.example.com/api/assets/agent-avatar',
          updatedAt: new Date().toISOString(),
          owner: {
            type: 'organization',
            id: 'org-1',
            slug: 'builders',
            displayName: 'Builders',
            picture: 'https://identity.example.com/api/assets/org-avatar',
          },
          activity: { total: 19, activeDays: 4, currentStreak: 0, longestStreak: 4 },
          activityDays: [
            { date: today, count: 1 },
            { date: offsetUtcDate(today, -1), count: 3 },
            { date: offsetUtcDate(today, -2), count: 6 },
            { date: offsetUtcDate(today, -3), count: 10 },
          ],
          recentActivity: [],
        }),
      ),
    )

    renderProfile(<PublicAgentProfilePage subject="agt_org" />)

    expect(await screen.findByText('Builders')).toBeTruthy()
    expect(screen.getByText('No active streak')).toBeTruthy()
    expect(screen.getByText('No public activity yet.')).toBeTruthy()
    expect(screen.getByText('Today')).toBeTruthy()
    expect(document.querySelectorAll('.heatLevel4').length).toBeGreaterThan(1)
    expect(screen.queryByRole('link', { name: /Builders/ })).toBeNull()
  })

  it('renders a User owner without a public username as non-navigable', async () => {
    server.use(
      http.get('/api/public/agents/agt_private_owner', () =>
        HttpResponse.json({
          ...agentProfile,
          subject: 'agt_private_owner',
          owner: { ...agentProfile.owner, username: null },
        }),
      ),
    )

    renderProfile(<PublicAgentProfilePage subject="agt_private_owner" />)

    expect(await screen.findByText('Jane Stone')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Jane Stone/ })).toBeNull()
  })

  it('shows not found only for a 404 response', async () => {
    server.use(http.get('/api/public/users/missing', () => HttpResponse.json({ error: 'missing' }, { status: 404 })))

    renderProfile(<PublicUserProfilePage username="missing" />)

    expect(await screen.findByRole('heading', { name: 'User profile not found' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows a retryable load failure for server and protocol errors', async () => {
    let attempts = 0
    server.use(
      http.get('/api/public/users/retry', () => {
        attempts += 1
        return attempts === 1
          ? HttpResponse.json({ error: 'unavailable' }, { status: 503 })
          : HttpResponse.json(userProfile)
      }),
    )

    renderProfile(<PublicUserProfilePage username="retry" />)
    expect(await screen.findByRole('heading', { name: 'Unable to load User profile' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(attempts).toBe(2)

    cleanup()
    server.use(http.get('/api/public/agents/broken', () => HttpResponse.json({ type: 'agent', view: 'full' })))
    renderProfile(<PublicAgentProfilePage subject="broken" />)
    expect(await screen.findByRole('heading', { name: 'Unable to load Agent profile' })).toBeTruthy()
  })
})

function renderProfile(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

const commonActivity = [
  {
    id: 'audit-1',
    action: 'agent.identity_enrolled',
    title: 'Agent identity enrolled',
    description: 'A stable Agent identity was created.',
    occurredAt: '2026-08-07T12:00:00.000Z',
  },
]

const userProfile = {
  type: 'user',
  view: 'full',
  id: 'user-1',
  username: 'jane',
  displayName: 'Jane Stone',
  picture: null,
  joinedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-08-07T12:00:00.000Z',
  bio: 'Building useful Agents.',
  location: 'Toronto',
  links: [
    { type: 'website', label: 'Website', url: 'https://jane.example.com' },
    { type: 'linked-account', providerId: 'github', label: 'GitHub', url: 'https://github.com/jane' },
  ],
  agentCount: 1,
  agents: [
    {
      subject: 'agt_stable',
      name: 'Build Agent',
      picture: 'https://identity.example.com/agent-picture-v1.svg',
      createdAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-08-07T12:00:00.000Z',
    },
  ],
  recentActivity: commonActivity,
} as const

const agentProfile = {
  type: 'agent',
  view: 'full',
  issuer: 'https://identity.example.com/api/auth',
  subject: 'agt_stable',
  name: 'Build Agent',
  picture: 'https://identity.example.com/agent-picture-v1.svg',
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-08-07T12:00:00.000Z',
  owner: { type: 'user', id: 'user-1', username: 'jane', displayName: 'Jane Stone', picture: null },
  activity: { total: 12, activeDays: 5, currentStreak: 2, longestStreak: 4 },
  activityDays: [{ date: '2026-08-07', count: 2 }],
  recentActivity: commonActivity,
} as const

function offsetUtcDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
