import { createId } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'

export function appendAgentGovernanceAudit(
  deps: Deps,
  input: {
    id?: string
    action: string
    result: 'allowed' | 'denied' | 'pending'
    controllerUserId: string | null
    issuer?: string | null
    subject?: string | null
    agentIdentityId?: string | null
    hostId?: string | null
    capabilities?: string[] | null
    reasonCode?: string | null
    metadata?: Record<string, unknown> | null
    occurredAt?: Date
  },
) {
  return deps.agentAudit.append({
    id: input.id ?? createId('agaudit'),
    action: input.action,
    result: input.result,
    controllerUserId: input.controllerUserId,
    subjectIssuer: input.issuer ?? null,
    subject: input.subject ?? null,
    agentIdentityId: input.agentIdentityId ?? null,
    hostId: input.hostId ?? null,
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: input.capabilities ?? null,
    reasonCode: input.reasonCode ?? null,
    metadata: input.metadata ?? null,
    occurredAt: input.occurredAt ?? new Date(),
  })
}
