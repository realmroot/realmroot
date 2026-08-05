import { createTestDeps } from '@server/http/test-deps'
import { appendAgentGovernanceAudit, managementActorAuditRecord } from '@server/usecases/agent-audit'
import { describe, expect, it } from 'vitest'

describe('Agent governance audit', () => {
  it('normalizes omitted and supplied governance context', async () => {
    const deps = createTestDeps()

    await appendAgentGovernanceAudit(deps, {
      action: 'agent.requested',
      result: 'pending',
      controllerUserId: null,
      owner: { kind: 'realm' },
    })
    await appendAgentGovernanceAudit(deps, {
      action: 'agent.approved',
      result: 'allowed',
      controllerUserId: 'user-1',
      owner: { kind: 'account', userId: 'user-1' },
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

  it('preserves a management Agent identity and target owner without collapsing it to a system actor', async () => {
    const deps = createTestDeps()

    await deps.agentAudit.append(
      managementActorAuditRecord({
        action: 'management.application.created',
        actor: {
          kind: 'agent',
          issuer: 'https://id.realmroot.dev',
          subject: 'agt_protocol',
          identityId: 'agent-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-1',
          authority: { kind: 'realm' },
        },
        owner: { kind: 'organization', organizationId: 'org-target' },
        metadata: { applicationId: 'app-1' },
      }),
    )

    expect(deps.agentAudit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'management.application.created',
        controllerUserId: null,
        subjectIssuer: 'https://id.realmroot.dev',
        subject: 'agt_protocol',
        agentIdentityId: 'agent-1',
        hostId: 'host-1',
        ownerUserId: null,
        ownerOrganizationId: 'org-target',
        metadata: {
          applicationId: 'app-1',
          actor: {
            kind: 'agent',
            protocolAgentId: 'protocol-agent-1',
            authority: { kind: 'realm' },
          },
        },
      }),
    )
  })
})
