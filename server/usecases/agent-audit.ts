import {
  type ManagementActor,
  type ManagementOwner,
  managementOwnerColumns,
} from '@server/domain/management-authorization'
import { createId } from '@server/usecases/applications-utils'
import type { Deps } from '@server/usecases/deps'

export function appendAgentGovernanceAudit(
  deps: Deps,
  input: {
    action: string
    result: 'allowed' | 'denied' | 'pending'
    controllerUserId: string | null
    owner: ManagementOwner
    issuer?: string | null
    subject?: string | null
    agentIdentityId?: string | null
    hostId?: string | null
    capabilities?: string[] | null
    reasonCode?: string | null
    metadata?: Record<string, unknown> | null
  },
) {
  return deps.agentAudit.append({
    id: createId('agaudit'),
    action: input.action,
    result: input.result,
    controllerUserId: input.controllerUserId,
    subjectIssuer: input.issuer ?? null,
    subject: input.subject ?? null,
    agentIdentityId: input.agentIdentityId ?? null,
    hostId: input.hostId ?? null,
    ...managementOwnerColumns(input.owner),
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: input.capabilities ?? null,
    reasonCode: input.reasonCode ?? null,
    metadata: input.metadata ?? null,
    occurredAt: new Date(),
  })
}

export function managementActorUserId(actor: ManagementActor): string | null {
  return actor.kind === 'user' ? actor.userId : null
}

export function managementActorAuditRecord(input: {
  action: string
  actor: ManagementActor
  owner: ManagementOwner
  metadata?: Record<string, unknown>
}) {
  const actorMetadata =
    input.actor.kind === 'user'
      ? { kind: 'user', userId: input.actor.userId }
      : {
          kind: 'agent',
          protocolAgentId: input.actor.protocolAgentId,
          authority: input.actor.authority,
        }

  return {
    id: createId('agaudit'),
    action: input.action,
    result: 'allowed',
    controllerUserId: managementActorUserId(input.actor),
    subjectIssuer: input.actor.kind === 'agent' ? input.actor.issuer : null,
    subject: input.actor.kind === 'agent' ? input.actor.subject : null,
    agentIdentityId: input.actor.kind === 'agent' ? input.actor.identityId : null,
    hostId: input.actor.kind === 'agent' ? input.actor.hostId : null,
    ...managementOwnerColumns(input.owner),
    resourceId: null,
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: null,
    reasonCode: null,
    metadata: { ...input.metadata, actor: actorMetadata },
    occurredAt: new Date(),
  }
}
