import type { AuthorizationTenant } from '@server/domain/authorization-context'
import { createId } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'

type AgentGovernanceAuditInput = {
  action: string
  result: 'allowed' | 'denied' | 'pending'
  tenant: AuthorizationTenant
  controllerUserId: string | null
  issuer?: string | null
  subject?: string | null
  agentIdentityId?: string | null
  hostId?: string | null
  capabilities?: string[] | null
  reasonCode?: string | null
  metadata?: Record<string, unknown> | null
}

export function appendAgentGovernanceAudit(deps: Deps, input: AgentGovernanceAuditInput) {
  return deps.agentAudit.append(agentGovernanceAuditRecord(input))
}

export function agentGovernanceAuditRecord(input: AgentGovernanceAuditInput) {
  return {
    id: createId('agaudit'),
    action: input.action,
    result: input.result,
    realmOwned: input.tenant.type === 'realm',
    ownerUserId: input.tenant.type === 'user' ? input.tenant.id : null,
    ownerOrganizationId: input.tenant.type === 'organization' ? input.tenant.id : null,
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
    occurredAt: new Date(),
  }
}
