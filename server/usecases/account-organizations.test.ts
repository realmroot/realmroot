import { createTestDeps } from '@server/http/test-deps'
import {
  listAccountOrganizationAgentAuthorizations,
  listAccountOrganizationAgents,
  listAccountOrganizationRoleAssignments,
  listAccountRoleAssignments,
} from '@server/usecases/account-organizations'
import type { AgentIdentityAggregate } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'

describe('Account Organization Agents', () => {
  it('lists the signed-in user realm role assignments through Account Center', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.listRoleAssignments).mockResolvedValue({
      items: [],
      pagination: { limit: 20, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })

    await expect(listAccountRoleAssignments(deps, 'user-1', { limit: 20, offset: 0 })).resolves.toEqual({
      assignments: [],
      pagination: { limit: 20, offset: 0, total: 0, hasMore: false, nextOffset: null },
    })
    expect(deps.authorization.listRoleAssignments).toHaveBeenCalledWith({
      limit: 20,
      offset: 0,
      context: 'realm',
      subjectType: 'user',
      subjectId: 'user-1',
    })
  })

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

  it('reads Account Center authority relationships through an exact Organization boundary', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(deps.authorization.listRoleAssignments).mockResolvedValue({
      items: [
        {
          id: 'assignment-1',
          roleId: 'role-1',
          subjectType: 'user',
          subjectId: 'user-1',
          organizationId: 'org-1',
          assignedByUserId: null,
          expiresAt: null,
          revokedAt: null,
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
        },
      ],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })
    vi.mocked(deps.authorization.findRole).mockResolvedValue({
      id: 'role-1',
      key: 'viewer',
      name: 'Viewer',
      description: null,
      system: false,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    })
    vi.mocked(deps.authorization.listRolePermissions).mockResolvedValue([
      { resourceId: 'resource-1', scope: 'objects:read' },
    ])

    await expect(
      listAccountOrganizationRoleAssignments(deps, 'org-1', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({
      assignments: [{ assignment: { id: 'assignment-1' }, role: { id: 'role-1' } }],
    })
    expect(deps.authorization.listRoleAssignments).toHaveBeenCalledWith(
      expect.objectContaining({
        contextualOrganizationId: 'org-1',
        subjectType: 'user',
        subjectId: 'user-1',
        status: 'active',
      }),
    )
  })

  it('does not expose another Organization grants through Account Center', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(deps.externalResources.listGrants).mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })

    await expect(
      listAccountOrganizationAgentAuthorizations(deps, 'org-1', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toMatchObject({ grants: [], pagination: { total: 0 } })
    expect(deps.externalResources.listGrants).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', status: 'active' }),
      { ownerOrganizationIds: ['org-1'] },
    )
  })

  it('projects authorized Agents only after applying the exact Organization owner filter', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.authorization.findMemberByOrganizationUser).mockResolvedValue({ id: 'member-1' } as never)
    vi.mocked(deps.authorization.findResource).mockResolvedValue({
      id: 'resource-1',
      identifier: 'https://resource.example.com',
      name: 'Resource',
    } as never)
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(organizationAgent('agent-1'))
    vi.mocked(deps.externalResources.listGrants).mockResolvedValue({
      items: [
        {
          id: 'grant-1',
          agentIdentityId: 'agent-1',
          resourceId: 'resource-1',
          scopes: ['objects:read'],
          authorizationDetails: null,
          mode: 'native',
          status: 'active',
          expiresAt: null,
          createdAt: now(),
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    } as never)

    await expect(
      listAccountOrganizationAgentAuthorizations(deps, 'org-1', 'user-1', { limit: 20, offset: 0 }),
    ).resolves.toEqual({
      grants: [
        {
          id: 'grant-1',
          agentId: 'agent-1',
          agentName: 'agent-1',
          resourceId: 'resource-1',
          scopes: ['objects:read'],
          mode: 'native',
          expiresAt: null,
          createdAt: now().toISOString(),
        },
      ],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false, nextOffset: null },
    })
  })
})

function organizationAgent(id: string): AgentIdentityAggregate {
  const createdAt = now()
  return {
    identity: {
      id,
      issuer: 'https://auth.example.com',
      subject: `agt_${id}`,
      name: id,
      ownerUserId: null,
      ownerOrganizationId: 'org-1',
      status: 'active',
      retiredAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    bindings: [],
  }
}

function now() {
  return new Date('2026-08-02T00:00:00.000Z')
}
