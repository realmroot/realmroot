export const accountQueryKeys = {
  agents: ['account', 'agents'] as const,
  applications: ['account', 'applications'] as const,
  configz: ['configz'] as const,
  linkedAccounts: ['account', 'linked-accounts'] as const,
  externalApiResources: ['account', 'api-resources'] as const,
  accountConnections: ['account', 'account-connections'] as const,
  providerConnections: ['account', 'provider-connections'] as const,
  providerConnectors: ['account', 'provider-connectors'] as const,
  accessRequests: ['account', 'access-requests'] as const,
  passkeys: ['account', 'passkeys'] as const,
  profile: ['account', 'profile'] as const,
  developerConsoleAccess: ['account', 'developer-console-access'] as const,
  organizationContext: ['account', 'organization-context'] as const,
  organizations: ['account', 'organizations'] as const,
  organizationInvitations: ['account', 'organization-invitations'] as const,
  organizationAgents: (organizationId: string) => ['account', 'organizations', organizationId, 'agents'] as const,
  organizationRoles: (organizationId: string) => ['account', 'organizations', organizationId, 'roles'] as const,
  security: ['account', 'security'] as const,
  sessions: ['account', 'sessions'] as const,
}

export const accountQueryOptions = { retry: false, staleTime: 60_000 } as const
