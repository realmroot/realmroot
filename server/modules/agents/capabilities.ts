import type { Capability } from '@better-auth/agent-auth'

export const agentCapabilities = [
  {
    name: 'account.profile.read',
    description: 'Read the delegated user profile.',
    approvalStrength: 'session',
    output: {
      type: 'object',
      required: ['user'],
      properties: {
        user: { type: 'object' },
      },
    },
  },
  {
    name: 'account.sessions.list',
    description: 'List the delegated user sessions.',
    approvalStrength: 'session',
    input: paginationInputSchema(),
    output: {
      type: 'object',
      required: ['sessions', 'pagination'],
      properties: {
        sessions: { type: 'array', items: { type: 'object' } },
        pagination: { type: 'object' },
      },
    },
  },
  {
    name: 'account.authorized_apps.list',
    description: 'List applications authorized by the delegated user.',
    approvalStrength: 'session',
    input: paginationInputSchema(),
    output: {
      type: 'object',
      required: ['applications', 'pagination'],
      properties: {
        applications: { type: 'array', items: { type: 'object' } },
        pagination: { type: 'object' },
      },
    },
  },
] as const satisfies Capability[]

export const agentCapabilityNames = agentCapabilities.map((capability) => capability.name)

const agentCapabilityNameSet = new Set<string>(agentCapabilityNames)

export function isKnownAgentCapability(capability: string) {
  return agentCapabilityNameSet.has(capability)
}

export function areKnownAgentCapabilities(capabilities: string[]) {
  return capabilities.every(isKnownAgentCapability)
}

function paginationInputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
  }
}
