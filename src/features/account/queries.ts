import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getConfigz } from '@/lib/api'
import {
  getAccountOrganization,
  getAccountOrganizationAuthority,
  getAccountProfile,
  getAccountSecurity,
  listAccountAgents,
  listAccountConnections,
  listAccountOrganizationAgents,
  listAccountOrganizationInvitations,
  listAccountOrganizations,
  listAccountSessions,
  listAgentResourceRequests,
  listConsentedApplications,
  listExternalApiResources,
  listLinkedAccounts,
  listPasskeys,
} from '@/lib/api/account'
import { tt } from '@/lib/i18n'

export const accountQueryKeys = {
  agents: ['account', 'agents'] as const,
  applications: ['account', 'applications'] as const,
  configz: ['configz'] as const,
  linkedAccounts: ['account', 'linked-accounts'] as const,
  externalApiResources: ['account', 'api-resources'] as const,
  accountConnections: ['account', 'account-connections'] as const,
  accessRequests: ['account', 'access-requests'] as const,
  passkeys: ['account', 'passkeys'] as const,
  profile: ['account', 'profile'] as const,
  organizations: ['account', 'organizations'] as const,
  organizationInvitations: ['account', 'organization-invitations'] as const,
  organizationAgents: (organizationId: string) => ['account', 'organizations', organizationId, 'agents'] as const,
  organizationAuthority: (organizationId: string) => ['account', 'organizations', organizationId, 'authority'] as const,
  security: ['account', 'security'] as const,
  sessions: ['account', 'sessions'] as const,
}

const staleTime = 60_000
const accountQueryOptions = { retry: false, staleTime } as const

export function useAccountConfig() {
  return useQuery({
    queryKey: accountQueryKeys.configz,
    queryFn: getConfigz,
    ...accountQueryOptions,
  })
}

export function useAccountProfile() {
  return useQuery({
    queryKey: accountQueryKeys.profile,
    queryFn: getAccountProfile,
    ...accountQueryOptions,
  })
}

export function useAccountOrganizations() {
  return useQuery({
    queryKey: accountQueryKeys.organizations,
    queryFn: listAccountOrganizations,
    ...accountQueryOptions,
  })
}

export function useAccountOrganizationInvitations() {
  return useQuery({
    queryKey: accountQueryKeys.organizationInvitations,
    queryFn: listAccountOrganizationInvitations,
    ...accountQueryOptions,
  })
}

export function useAccountOrganization(organizationId: string) {
  return useQuery({
    queryKey: [...accountQueryKeys.organizations, organizationId],
    queryFn: () => getAccountOrganization(organizationId),
    ...accountQueryOptions,
  })
}

export function useAccountOrganizationAgents(organizationId: string) {
  return useQuery({
    queryKey: accountQueryKeys.organizationAgents(organizationId),
    queryFn: () => listAccountOrganizationAgents(organizationId),
    ...accountQueryOptions,
  })
}

export function useAccountOrganizationAuthority(organizationId: string) {
  return useQuery({
    queryKey: accountQueryKeys.organizationAuthority(organizationId),
    queryFn: () => getAccountOrganizationAuthority(organizationId),
    ...accountQueryOptions,
  })
}

export function useAccountSecurity() {
  return useQuery({
    queryKey: accountQueryKeys.security,
    queryFn: getAccountSecurity,
    ...accountQueryOptions,
  })
}

export function useAccountPasskeys() {
  return useQuery({
    queryKey: accountQueryKeys.passkeys,
    queryFn: listPasskeys,
    ...accountQueryOptions,
  })
}

export function useAccountSessions(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: accountQueryKeys.sessions,
    queryFn: listAccountSessions,
    ...accountQueryOptions,
  })
}

export function useLinkedAccounts(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: accountQueryKeys.linkedAccounts,
    queryFn: listLinkedAccounts,
    ...accountQueryOptions,
  })
}

export function useConsentedApplications(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: accountQueryKeys.applications,
    queryFn: listConsentedApplications,
    ...accountQueryOptions,
  })
}

export function useAccountAgents() {
  return useQuery({
    queryKey: accountQueryKeys.agents,
    queryFn: listAccountAgents,
    ...accountQueryOptions,
  })
}

export function useExternalApiResources() {
  return useQuery({
    queryKey: accountQueryKeys.externalApiResources,
    queryFn: listExternalApiResources,
    ...accountQueryOptions,
  })
}

export function useAccountConnections() {
  return useQuery({
    queryKey: accountQueryKeys.accountConnections,
    queryFn: listAccountConnections,
    ...accountQueryOptions,
  })
}

export function useAccountAccessRequests() {
  return useQuery({
    queryKey: accountQueryKeys.accessRequests,
    queryFn: listAgentResourceRequests,
    ...accountQueryOptions,
  })
}

export function useAccountMutation() {
  const queryClient = useQueryClient()
  return async function mutate<T>(
    label: string,
    operation: () => Promise<T>,
    options: {
      invalidate?: readonly (readonly unknown[])[]
      invalidateExact?: readonly (readonly unknown[])[]
      onError?: (message: string) => void
    } = {},
  ) {
    try {
      const result = await operation()
      toast.success(tt(label))
      for (const queryKey of options.invalidate ?? []) {
        await queryClient.invalidateQueries({ queryKey })
      }
      for (const queryKey of options.invalidateExact ?? []) {
        await queryClient.invalidateQueries({ exact: true, queryKey })
      }
      return result
    } catch (mutationError) {
      const message = mutationError instanceof Error ? tt(mutationError.message) : tt('Account update failed.')
      options.onError?.(message)
      toast.error(message)
      return undefined
    }
  }
}
