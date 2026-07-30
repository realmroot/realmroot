/**
 * Canonical set of agent capability names and the pure validation helpers
 * built on top of them. Framework-free so it stays inside the domain layer;
 * the better-auth-typed capability descriptors live in server/auth-capabilities.
 */
import { protectedResourceCapabilityNames } from '@shared/authz'

export { protectedResourceCapabilityNames } from '@shared/authz'

export const accountAgentCapabilityNames = [
  'account.profile.read',
  'account.sessions.list',
  'account.authorized_apps.list',
] as const

export const agentCapabilityNames = [...accountAgentCapabilityNames, ...protectedResourceCapabilityNames] as const

const agentCapabilityNameSet = new Set<string>(agentCapabilityNames)

export function isKnownAgentCapability(capability: string) {
  return agentCapabilityNameSet.has(capability)
}

export function areKnownAgentCapabilities(capabilities: string[]) {
  return capabilities.every(isKnownAgentCapability)
}
