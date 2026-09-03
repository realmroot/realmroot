import { accountRoutes } from '@server/http/routes/account'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

describe('account Organization Team routes', () => {
  it('lists Team members through the Organization administration boundary', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ roles: ['owner'] } as never)
    vi.mocked(deps.authorization.findTeam).mockResolvedValue({ id: 'team-1', organizationId: 'org-1' } as never)
    vi.mocked(deps.authorization.listTeamMembers).mockResolvedValue({
      items: [{ id: 'membership-1', teamId: 'team-1', userId: 'user-2', createdAt: '2026-08-01T00:00:00Z' }],
      pagination: { page: Math.floor(20 / 10) + 1, pageSize: 10, totalItems: 21, totalPages: Math.ceil(21 / 10) },
    })
    const app = withAccountContext(deps)
    app.route('/account', accountRoutes({} as never))

    const response = await app.request('/account/organizations/org-1/teams/team-1/members?page=3&pageSize=10')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'membership-1', userId: 'user-2' }],
      pagination: { page: Math.floor(20 / 10) + 1, pageSize: 10, totalItems: 21, totalPages: Math.ceil(21 / 10) },
    })
    expect(deps.authorization.listTeamMembers).toHaveBeenCalledWith('team-1', { limit: 10, offset: 20 })
  })
})

function withAccountContext(deps: ReturnType<typeof createTestDeps>) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const user = { id: 'user-1', role: 'user', email: 'user@example.com' }
    c.set('principal', {
      session: { session: { id: 'session-1' }, user },
      user,
    })
    c.set('deps', deps)
    await next()
  })
  return app
}
