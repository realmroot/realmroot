import { type RealmrootAgentBindingClaim, realmrootAgentBindingClaim } from '@shared/oauth-token-profile'

const runtimePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const maximumSessionIdLength = 1024

export function readRealmrootAgentBinding(payload: Record<string, unknown>): RealmrootAgentBindingClaim | null {
  const value = payload[realmrootAgentBindingClaim]
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The Agent binding claim is invalid.')
  }
  const binding = value as Record<string, unknown>
  const protocolAgentId = requiredString(binding.protocol_agent_id)
  const hostId = requiredString(binding.host_id)
  if (!protocolAgentId || !hostId) throw new Error('The Agent binding claim is invalid.')

  const runtime = binding.runtime
  const sessionId = binding.session_id
  if (runtime === undefined && sessionId === undefined) {
    return { protocol_agent_id: protocolAgentId, host_id: hostId }
  }
  if (
    typeof runtime !== 'string' ||
    !runtimePattern.test(runtime) ||
    typeof sessionId !== 'string' ||
    sessionId.trim() === '' ||
    sessionId.length > maximumSessionIdLength
  ) {
    throw new Error('The Agent runtime session binding is invalid.')
  }
  return {
    protocol_agent_id: protocolAgentId,
    host_id: hostId,
    runtime,
    session_id: sessionId,
  }
}

function requiredString(value: unknown) {
  return typeof value === 'string' && value !== '' ? value : null
}
