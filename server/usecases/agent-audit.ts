import { createId } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'
import type { AgentAuditEventRecord } from '@server/usecases/ports'
import type { AuthorizationDetail } from '@shared/api/authorization-details'

export function createAgentGovernanceAuditEvent(input: {
  action: string
  result: 'allowed' | 'denied' | 'pending'
  controllerUserId: string | null
  issuer?: string | null
  subject?: string | null
  agentIdentityId?: string | null
  hostId?: string | null
  owner: { kind: 'realm'; id: 'realm' } | { kind: 'organization' | 'account'; id: string }
  capabilities?: string[] | null
  reasonCode?: string | null
  metadata?: Record<string, unknown> | null
}): AgentAuditEventRecord {
  return {
    id: createId('agaudit'),
    action: input.action,
    result: input.result,
    controllerUserId: input.controllerUserId,
    subjectIssuer: input.issuer ?? null,
    subject: input.subject ?? null,
    agentIdentityId: input.agentIdentityId ?? null,
    hostId: input.hostId ?? null,
    ownerKind: input.owner.kind,
    ownerId: input.owner.id,
    quarantineReason: null,
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: input.capabilities ?? null,
    reasonCode: input.reasonCode ?? null,
    metadata: input.metadata ?? null,
    occurredAt: new Date(),
  }
}

export function appendAgentGovernanceAudit(deps: Deps, input: Parameters<typeof createAgentGovernanceAuditEvent>[0]) {
  return deps.agentAudit.append(createAgentGovernanceAuditEvent(input))
}

export async function resolveAgentAuditOwner(
  deps: Deps,
  input: {
    connection: { ownerUserId: string | null; ownerOrganizationId: string | null } | null
    authorizationDetails: AuthorizationDetail[]
    identityId: string | null
    resourceId: string
  },
): Promise<{ kind: 'realm' | 'organization' | 'account'; id: string }> {
  if (input.connection?.ownerUserId) return { kind: 'account', id: input.connection.ownerUserId }
  if (input.connection?.ownerOrganizationId) {
    return { kind: 'organization', id: input.connection.ownerOrganizationId }
  }
  const authority = input.authorizationDetails.find((detail) => detail.type === 'realmroot_authority') as
    | { authority?: unknown; id?: unknown }
    | undefined
  if (authority?.authority === 'realm' && authority.id === 'realm') return { kind: 'realm', id: 'realm' }
  if (authority?.authority === 'account' && typeof authority.id === 'string') {
    return { kind: 'account', id: authority.id }
  }
  if (authority?.authority === 'organization' && typeof authority.id === 'string') {
    return { kind: 'organization', id: authority.id }
  }
  if (input.identityId) {
    const identity = await deps.agentIdentities.findIdentity(input.identityId)
    if (identity?.identity.ownerUserId) return { kind: 'account', id: identity.identity.ownerUserId }
    if (identity?.identity.ownerOrganizationId) {
      return { kind: 'organization', id: identity.identity.ownerOrganizationId }
    }
  }
  const resource = await deps.authorization.findResource(input.resourceId)
  if (resource?.ownerOrganizationId) return { kind: 'organization', id: resource.ownerOrganizationId }
  throw new Error('Agent audit owner could not be resolved from authoritative resource data.')
}
