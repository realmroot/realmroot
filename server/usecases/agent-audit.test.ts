import { createTestDeps } from '@server/http/test-deps'
import { appendAgentGovernanceAudit, resolveAgentAuditOwner } from '@server/usecases/agent-audit'
import { describe, expect, it, vi } from 'vitest'

describe('Agent governance audit', () => {
  it('normalizes omitted and supplied governance context', async () => {
    const deps = createTestDeps()

    await appendAgentGovernanceAudit(deps, {
      action: 'agent.requested',
      result: 'pending',
      controllerUserId: null,
      owner: { kind: 'realm', id: 'realm' },
    })
    await appendAgentGovernanceAudit(deps, {
      action: 'agent.approved',
      result: 'allowed',
      controllerUserId: 'user-1',
      owner: { kind: 'account', id: 'user-1' },
      issuer: 'https://auth.example.com',
      subject: 'agt_1',
      agentIdentityId: 'agent-1',
      hostId: 'host-1',
      capabilities: ['applications:read'],
      reasonCode: 'approved',
      metadata: { source: 'console' },
    })

    expect(deps.agentAudit.append).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: 'agent.requested',
        subjectIssuer: null,
        subject: null,
        agentIdentityId: null,
        hostId: null,
        scopes: null,
        reasonCode: null,
        metadata: null,
      }),
    )
    expect(deps.agentAudit.append).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'agent.approved',
        subjectIssuer: 'https://auth.example.com',
        subject: 'agt_1',
        agentIdentityId: 'agent-1',
        hostId: 'host-1',
        scopes: ['applications:read'],
        reasonCode: 'approved',
        metadata: { source: 'console' },
      }),
    )
  })

  it('resolves only authoritative Account, Organization, and Realm owners and fails closed', async () => {
    const deps = createTestDeps()
    const base = { authorizationDetails: [], identityId: null, resourceId: 'resource-1' }
    await expect(
      resolveAgentAuditOwner(deps, {
        ...base,
        connection: { ownerUserId: 'user-1', ownerOrganizationId: null },
      }),
    ).resolves.toEqual({ kind: 'account', id: 'user-1' })
    await expect(
      resolveAgentAuditOwner(deps, {
        ...base,
        connection: { ownerUserId: null, ownerOrganizationId: 'org-1' },
      }),
    ).resolves.toEqual({ kind: 'organization', id: 'org-1' })

    for (const [authority, expected] of [
      [
        { type: 'realmroot_authority', authority: 'realm', id: 'realm' },
        { kind: 'realm', id: 'realm' },
      ],
      [
        { type: 'realmroot_authority', authority: 'account', id: 'user-2' },
        { kind: 'account', id: 'user-2' },
      ],
      [
        { type: 'realmroot_authority', authority: 'organization', id: 'org-2' },
        { kind: 'organization', id: 'org-2' },
      ],
    ] as const) {
      await expect(
        resolveAgentAuditOwner(deps, { ...base, connection: null, authorizationDetails: [authority] }),
      ).resolves.toEqual(expected)
    }

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      identity: { ownerUserId: 'user-3', ownerOrganizationId: null },
      bindings: [],
    } as never)
    await expect(resolveAgentAuditOwner(deps, { ...base, connection: null, identityId: 'agent-1' })).resolves.toEqual({
      kind: 'account',
      id: 'user-3',
    })
    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue({
      identity: { ownerUserId: null, ownerOrganizationId: 'org-3' },
      bindings: [],
    } as never)
    await expect(resolveAgentAuditOwner(deps, { ...base, connection: null, identityId: 'agent-1' })).resolves.toEqual({
      kind: 'organization',
      id: 'org-3',
    })

    vi.mocked(deps.agentIdentities.findIdentity).mockResolvedValue(null)
    vi.mocked(deps.authorization.findResource).mockResolvedValue({ ownerOrganizationId: 'org-4' } as never)
    await expect(resolveAgentAuditOwner(deps, { ...base, connection: null })).resolves.toEqual({
      kind: 'organization',
      id: 'org-4',
    })
    vi.mocked(deps.authorization.findResource).mockResolvedValue(null)
    await expect(resolveAgentAuditOwner(deps, { ...base, connection: null })).rejects.toThrow(
      'Agent audit owner could not be resolved',
    )
  })
})
