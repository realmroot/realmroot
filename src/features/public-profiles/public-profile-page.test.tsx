import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PublicAgentProfilePage, PublicUserProfilePage } from './public-profile-page'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params, to }: { children: ReactNode; params?: Record<string, string>; to: string }) => (
    <a href={Object.entries(params ?? {}).reduce((path, [key, value]) => path.replace(`$${key}`, value), to)}>
      {children}
    </a>
  ),
}))

const server = setupServer(
  http.get('/api/public/users/jane', () => HttpResponse.json(userProfile)),
  http.get('/api/public/agents/agt_stable', () => HttpResponse.json(agentProfile)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
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
  })

  it('shows overview, heatmap, and recent activity on the Agent profile', async () => {
    renderProfile(<PublicAgentProfilePage subject="agt_stable" />)

    expect(await screen.findByRole('heading', { name: 'Build Agent' })).toBeTruthy()
    expect(screen.getByText('Current streak')).toBeTruthy()
    expect(screen.getByLabelText('Agent activity heatmap')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy()
    expect(screen.getByText('Jane Stone')).toBeTruthy()
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
  links: [{ type: 'website', label: 'Website', url: 'https://jane.example.com' }],
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
