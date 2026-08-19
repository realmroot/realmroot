import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { accountQueryKeys, accountQueryOptions } from '@/lib/account-query'
import { getConfigz } from '@/lib/api'
import {
  getAccountOrganization,
  getAccountProfile,
  getAccountSecurity,
  getDeveloperConsoleAccess,
  listAccountAgents,
  listAccountApplicationAuthorizations,
  listAccountConnections,
  listAccountOrganizationAgents,
  listAccountOrganizationInvitations,
  listAccountOrganizationRoles,
  listAccountOrganizations,
  listAccountOrganizationTeamMembers,
  listAccountOrganizationTeams,
  listAccountProviderConnections,
  listAccountProviderConnectors,
  listAccountSessions,
  listAgentResourceRequests,
  listExternalApiResources,
  listLinkedAccounts,
  listPasskeys,
} from '@/lib/api/account'
import { tt } from '@/lib/i18n'

export { accountQueryKeys } from '@/lib/account-query'

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

export function useDeveloperConsoleAccess() {
  return useQuery({
    queryKey: accountQueryKeys.developerConsoleAccess,
    queryFn: getDeveloperConsoleAccess,
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

export function useAccountOrganizationRoles(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: accountQueryKeys.organizationRoles(organizationId),
    queryFn: () => listAccountOrganizationRoles(organizationId),
    enabled,
    ...accountQueryOptions,
  })
}

export function useAccountOrganizationTeams(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: accountQueryKeys.organizationTeams(organizationId),
    queryFn: () => listAccountOrganizationTeams(organizationId),
    enabled,
    ...accountQueryOptions,
  })
}

export function useAccountOrganizationTeamMembers(teamId: string | null) {
  return useQuery({
    queryKey: accountQueryKeys.organizationTeamMembers(teamId ?? 'none'),
    queryFn: () => listAccountOrganizationTeamMembers(teamId!),
    enabled: Boolean(teamId),
    ...accountQueryOptions,
  })
}

export function useAccountOrganizationAgents(organizationId: string, enabled = true) {
  return useQuery({
    queryKey: accountQueryKeys.organizationAgents(organizationId),
    queryFn: () => listAccountOrganizationAgents(organizationId),
    enabled,
    ...accountQueryOptions,
  })
}

export function useAccountSecurity(enabled = true) {
  return useQuery({
    enabled,
    queryKey: accountQueryKeys.security,
    queryFn: getAccountSecurity,
    ...accountQueryOptions,
  })
}

export function useAccountPasskeys(enabled = true) {
  return useQuery({
    enabled,
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

export function useAccountProviderConnectors() {
  return useQuery({
    queryKey: accountQueryKeys.providerConnectors,
    queryFn: listAccountProviderConnectors,
    ...accountQueryOptions,
  })
}

export function useAccountProviderConnections(enabled = true) {
  return useQuery({
    enabled,
    queryKey: accountQueryKeys.providerConnections,
    queryFn: listAccountProviderConnections,
    ...accountQueryOptions,
  })
}

export function useAccountApplicationAuthorizations(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: accountQueryKeys.applications,
    queryFn: listAccountApplicationAuthorizations,
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
