export const realmrootCliClientId = 'realmroot-cli'
export const realmrootOrganizationClaim = 'urn:realmroot:params:oauth:org'
export const realmrootAgentBindingClaim = 'urn:realmroot:params:agent:binding'

export interface RealmrootAgentBindingClaim {
  protocol_agent_id: string
  host_id: string
  runtime?: string
  session_id?: string
}

export function toRealmrootAgentBindingClaim(input: {
  protocolAgentId: string
  hostId: string
  runtime?: string
  sessionId?: string
}): RealmrootAgentBindingClaim {
  if ((input.runtime === undefined) !== (input.sessionId === undefined)) {
    throw new Error('Agent runtime and session ID must be provided together.')
  }
  return {
    protocol_agent_id: input.protocolAgentId,
    host_id: input.hostId,
    ...(input.runtime !== undefined && input.sessionId !== undefined
      ? { runtime: input.runtime, session_id: input.sessionId }
      : {}),
  }
}
