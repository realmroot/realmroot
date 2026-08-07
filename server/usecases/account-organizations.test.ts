import { createTestDeps } from '@server/http/test-deps'
import { listAccountOrganizationAgents } from '@server/usecases/account-organizations'
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

function organizationAgent(id: string): AgentIdentityAggregate {
  const now = new Date('2026-08-02T00:00:00.000Z')
  return {
    identity: {
      id,
      issuer: 'https://auth.example.com',
      subject: `agt_${id}`,
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
