import { createTestDeps } from '@server/http/test-deps'
import {
  listAccountOrganizationAgents,
  listAccountOrganizationTeamMembers,
} from '@server/usecases/account-organizations'
import type { AgentIdentityAggregate } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('Account Organization Agents', () => {
  it('lists only the requested page after verifying membership', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(deps.agentIdentities.listOrganization).mockResolvedValue([
      organizationAgent('agent-1'),
      organizationAgent('agent-2'),
      organizationAgent('agent-3'),
    ])

    await expect(
      listAccountOrganizationAgents(deps, 'org-1', 'user-1', { limit: 1, offset: 1 }),
    ).resolves.toMatchObject({
      items: [{ id: 'agent-2', homeSpace: { type: 'organization', organizationId: 'org-1' } }],
      pagination: { limit: 1, offset: 1, total: 3, hasMore: true, nextOffset: 2 },
    })
  })

  it('rejects callers outside the Organization', async () => {
    const deps = createTestDeps()

    await expect(
      listAccountOrganizationAgents(deps, 'org-1', 'user-1', { limit: 20, offset: 0 }),
    ).rejects.toMatchObject({ status: 403 })
    expect(deps.agentIdentities.listOrganization).not.toHaveBeenCalled()
  })
})

describe('Account Organization Team members', () => {
  it('[spec: account-center/account-organization-teams] lets an Organization admin inspect a Team they have not joined', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ roles: ['admin'] } as never)
    vi.mocked(deps.authorization.findTeam).mockResolvedValue({ id: 'team-1', organizationId: 'org-1' } as never)
    vi.mocked(deps.authorization.listTeamMembers).mockResolvedValue({
      items: [{ id: 'team-member-1', teamId: 'team-1', userId: 'user-2', createdAt: '2026-08-01T00:00:00Z' }],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })

    await expect(
      listAccountOrganizationTeamMembers(deps, 'org-1', 'team-1', 'admin-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ items: [{ userId: 'user-2' }], pagination: { total: 1 } })
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

function organizationAgent(id: string): AgentIdentityAggregate {
  const now = new Date('2026-08-02T00:00:00.000Z')
  return {
    identity: {
      id,
      issuer: 'https://auth.example.com',
      subject: `agt_${id}`,
      username: 'organization-agent.00000000000000000000000000000001',
      name: id,
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
      status: 'active',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    },
    bindings: [],
  }
}
