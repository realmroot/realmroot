import { createTestDeps } from '@server/http/test-deps'
import { listAccountOrganizationTeamMembers } from '@server/usecases/account-organizations'
import { describe, expect, it, vi } from 'vitest'

describe('Account Organization Team members', () => {
  it('[spec: account-center/account-organization-teams] lets an Organization admin inspect a Team they have not joined', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ roles: ['admin'] } as never)
    vi.mocked(deps.authorization.findTeam).mockResolvedValue({ id: 'team-1', organizationId: 'org-1' } as never)
    vi.mocked(deps.authorization.listTeamMembers).mockResolvedValue({
      items: [{ id: 'team-member-1', teamId: 'team-1', userId: 'user-2', createdAt: '2026-08-01T00:00:00Z' }],
      pagination: { page: Math.floor(0 / 20) + 1, pageSize: 20, totalItems: 1, totalPages: Math.ceil(1 / 20) },
    })

    await expect(
      listAccountOrganizationTeamMembers(deps, 'org-1', 'team-1', 'admin-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ items: [{ userId: 'user-2' }], pagination: { totalItems: 1 } })
  })

  it('rejects an ordinary Organization member', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ roles: ['member'] } as never)

    await expect(
      listAccountOrganizationTeamMembers(deps, 'org-1', 'team-1', 'user-1', { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 })
    expect(deps.authorization.findTeam).not.toHaveBeenCalled()
  })

  it('rejects callers outside the Organization', async () => {
    const deps = createTestDeps()

    await expect(
      listAccountOrganizationTeamMembers(deps, 'org-1', 'team-1', 'outsider-1', { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 })
    expect(deps.authorization.findTeam).not.toHaveBeenCalled()
  })

  it('does not expose a Team from another Organization', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ roles: ['owner'] } as never)
    vi.mocked(deps.authorization.findTeam).mockResolvedValue({ id: 'team-1', organizationId: 'org-2' } as never)

    await expect(
      listAccountOrganizationTeamMembers(deps, 'org-1', 'team-1', 'owner-1', { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ status: 404 })
    expect(deps.authorization.listTeamMembers).not.toHaveBeenCalled()
  })
})
