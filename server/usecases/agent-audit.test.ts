import { createTestDeps } from '@server/http/test-deps'
import { appendAgentGovernanceAudit } from '@server/usecases/agent-audit'
import { describe, expect, it } from 'vitest'

describe('Agent governance audit', () => {
  it('normalizes omitted and supplied governance context', async () => {
    const deps = createTestDeps()

    await appendAgentGovernanceAudit(deps, {
      action: 'agent.requested',
      result: 'pending',
      controllerUserId: null,
    })
    await appendAgentGovernanceAudit(deps, {
      action: 'agent.approved',
      result: 'allowed',
      controllerUserId: 'user-1',
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
})
