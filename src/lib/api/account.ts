import type {
  AccountEmailChangeConfirmInput,
  AccountEmailChangeInput,
  AccountOrganizationAgentsResponse,
  AccountPasswordChangeInput,
  AccountProfileUpdateInput,
  AccountWalletAddressLinkInput,
} from '@shared/api/account'
import {
  accountOrganizationTeamMembersResponseSchema,
  accountProviderConnectionsResponseSchema,
  accountProviderConnectorsResponseSchema,
  providerConnectionIntentSchema,
} from '@shared/api/account'
import type {
  AccessRequest,
  AccessRequestApproval,
  AccountConnection,
  Agent,
  AgentEnrollment,
  AuthorizationDetailCatalogEntry,
  ConnectableApiResourcesResponse,
  CreateAccountConnection,
  DecideAccessRequest,
} from '@shared/api/agent-api'
import type { AgentApprovalPreview } from '@shared/api/agents'
import type { CreateInvitationRequest, InvitationResponse, ListRolesResponse } from '@shared/api/authorization'
import type { PaginationQuery } from '@shared/api/pagination'
import type {
  SecurityPasskeyRegistrationOptionsInput,
  SecurityTotpDisableInput,
  SecurityTotpEnrollmentInput,
  SecurityTotpVerificationInput,
} from '@shared/api/security'
import { ApiRequestError, apiClient, readJsonResponse, readRpcResponse, uploadApiFile } from '@/lib/api'
import { authClient, nativeAuth } from '@/lib/auth-client'

export interface AccountOrganizationTeam {
  id: string
  name: string
  organizationId: string
  createdAt: Date
  updatedAt?: Date
}

export function getAccountProfile() {
  return readRpcResponse(apiClient.api.account.profile.$get())
}

export function getDeveloperConsoleAccess() {
  return readRpcResponse(apiClient.api.account['developer-console-access'].$get())
}

export function getAccountOrganizationContext() {
  return readRpcResponse(apiClient.api.account['organization-context'].$get())
}

export async function listAccountOrganizations() {
  return readAuthClientResult(await authClient.organization.list())
}

export async function listAccountOrganizationInvitations() {
  return readAuthClientResult(await authClient.organization.listUserInvitations())
}

export async function createAccountOrganization(input: { name: string; slug: string }) {
  return readAuthClientResult(await authClient.organization.create(input))
}

export async function getAccountOrganization(organizationId: string) {
  return readAuthClientResult(await authClient.organization.getFullOrganization({ query: { organizationId } }))
}

export async function setActiveAccountOrganization(organizationId: string | null) {
  return readAuthClientResult(await authClient.organization.setActive({ organizationId }))
}

export async function updateAccountOrganization(organizationId: string, input: { name: string; slug: string }) {
  return readAuthClientResult(await authClient.organization.update({ organizationId, data: input }))
}

export async function deleteAccountOrganization(organizationId: string) {
  return readAuthClientResult(await authClient.organization.delete({ organizationId }))
}

export async function leaveAccountOrganization(organizationId: string) {
  return readAuthClientResult(await authClient.organization.leave({ organizationId }))
}

export async function inviteAccountOrganizationMember(organizationId: string, input: CreateInvitationRequest) {
  return readJsonResponse<InvitationResponse>(
    await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function listAccountOrganizationRoles(organizationId: string) {
  return readJsonResponse<ListRolesResponse>(
    await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/roles?page=1&pageSize=100`),
  )
}

export async function cancelAccountOrganizationInvitation(invitationId: string) {
  return readAuthClientResult(await authClient.organization.cancelInvitation({ invitationId }))
}

export async function acceptAccountOrganizationInvitation(invitationId: string) {
  return readAuthClientResult(await authClient.organization.acceptInvitation({ invitationId }))
}

export async function rejectAccountOrganizationInvitation(invitationId: string) {
  return readAuthClientResult(await authClient.organization.rejectInvitation({ invitationId }))
}

export async function removeAccountOrganizationMember(organizationId: string, memberIdOrEmail: string) {
  return readAuthClientResult(await authClient.organization.removeMember({ organizationId, memberIdOrEmail }))
}

export async function updateAccountOrganizationMemberRole(organizationId: string, memberId: string, roles: string[]) {
  return readJsonResponse<{ roles: string[] }>(
    await fetch(
      `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/roles`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roles }),
      },
    ),
  )
}

export async function listAccountOrganizationTeams(organizationId: string) {
  return readAuthClientResult(
    await authClient.organization.listTeams({ query: { organizationId } }),
  ) as AccountOrganizationTeam[]
}

export async function createAccountOrganizationTeam(organizationId: string, name: string) {
  return readAuthClientResult(await authClient.organization.createTeam({ organizationId, name }))
}

export async function updateAccountOrganizationTeam(teamId: string, name: string) {
  return readAuthClientResult(await authClient.organization.updateTeam({ teamId, data: { name } }))
}

export async function deleteAccountOrganizationTeam(organizationId: string, teamId: string) {
  return readAuthClientResult(await authClient.organization.removeTeam({ organizationId, teamId }))
}

export async function listAccountOrganizationTeamMembers(
  organizationId: string,
  teamId: string,
  pagination: PaginationQuery,
) {
  return accountOrganizationTeamMembersResponseSchema.parse(
    await readRpcResponse(
      apiClient.api.account.organizations[':organizationId'].teams[':teamId'].members.$get({
        param: { organizationId, teamId },
        query: { page: String(pagination.page), pageSize: String(pagination.pageSize) },
      }),
    ),
  )
}

export async function addAccountOrganizationTeamMember(organizationId: string, teamId: string, userId: string) {
  return readAuthClientResult(await authClient.organization.addTeamMember({ organizationId, teamId, userId }))
}

export async function removeAccountOrganizationTeamMember(organizationId: string, teamId: string, userId: string) {
  return readAuthClientResult(await authClient.organization.removeTeamMember({ organizationId, teamId, userId }))
}

export function updateAccountProfile(input: AccountProfileUpdateInput) {
  return readRpcResponse(apiClient.api.account.profile.$patch({ json: input }))
}

export function uploadAccountAvatar(file: File) {
  return uploadApiFile('/api/account/avatar', file)
}

export function requestAccountEmailChange(input: AccountEmailChangeInput) {
  return readRpcResponse(apiClient.api.account.email.change.$post({ json: input }))
}

export function confirmAccountEmailChange(input: AccountEmailChangeConfirmInput) {
  return readRpcResponse(apiClient.api.account.email.confirm.$post({ json: input }))
}

export function changeAccountPassword(input: AccountPasswordChangeInput) {
  return readRpcResponse(apiClient.api.account.password.change.$post({ json: input }))
}

export function listLinkedAccounts() {
  return readRpcResponse(apiClient.api.account['linked-accounts'].$get())
}

export async function listAccountProviderConnectors() {
  return accountProviderConnectorsResponseSchema.parse(
    await readJsonResponse<unknown>(
      await fetch('/api/account/provider-connectors?page=1&pageSize=100', { credentials: 'same-origin' }),
    ),
  )
}

export async function listAccountProviderConnections() {
  return accountProviderConnectionsResponseSchema.parse(
    await readJsonResponse<unknown>(
      await fetch('/api/account/provider-connections?page=1&pageSize=100', { credentials: 'same-origin' }),
    ),
  )
}

export async function disconnectAccountProviderConnection(connectionId: string) {
  const response = await fetch(`/api/account/provider-connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!response.ok) await readJsonResponse<never>(response)
}

export async function createProviderConnectionIntent(connectorId: string) {
  const response = await fetch('/api/account/provider-connection-intents', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectorId }),
  })
  return providerConnectionIntentSchema.parse(await readJsonResponse<unknown>(response))
}

export function linkAccount(input: {
  providerType: 'social' | 'generic_oauth'
  providerId: string
  callbackURL: string
  errorCallbackURL?: string
  scopes?: string[]
}) {
  if (input.providerType === 'generic_oauth') {
    return nativeAuth('/oauth2/link', {
      providerId: input.providerId,
      callbackURL: input.callbackURL,
      errorCallbackURL: input.errorCallbackURL,
      scopes: input.scopes,
    })
  }

  return nativeAuth('/link-social', {
    provider: input.providerId,
    callbackURL: input.callbackURL,
    errorCallbackURL: input.errorCallbackURL,
    scopes: input.scopes,
  })
}

export function unlinkAccount(providerId: string, accountId: string) {
  return readRpcResponse(
    apiClient.api.account['linked-accounts'][':providerId'].$delete({
      param: { providerId },
      query: { accountId },
    }),
  )
}

export function linkWalletAddress(input: AccountWalletAddressLinkInput) {
  return readRpcResponse(apiClient.api.account['wallet-addresses'].$post({ json: input }))
}

export async function unlinkWalletAddress(accountId: string) {
  return readRpcResponse(apiClient.api.account['wallet-addresses'][':accountId'].$delete({ param: { accountId } }))
}

export function listAccountApplicationAuthorizations() {
  return readRpcResponse(apiClient.api.account['application-authorizations'].$get({ query: {} }))
}

export function revokeAccountApplicationAuthorization(authorizationId: string) {
  return readRpcResponse(
    apiClient.api.account['application-authorizations'][':authorizationId'].$delete({ param: { authorizationId } }),
  )
}

export function listAccountSessions() {
  return readRpcResponse(apiClient.api.account.sessions.$get())
}

export function listAccountAgents(): Promise<{
  items: Agent[]
  pagination: import('@shared/api/pagination').PaginationMetadata
}> {
  return readRpcResponse(apiClient.api.account.agents.$get())
}

export function listAccountOrganizationAgents(organizationId: string): Promise<AccountOrganizationAgentsResponse> {
  return readRpcResponse(
    apiClient.api.account.organizations[':organizationId'].agents.$get({ param: { organizationId }, query: {} }),
  )
}

export function getAgentEnrollment(enrollmentId: string): Promise<AgentEnrollment> {
  return fetch(`/api/account/agent-enrollments/${encodeURIComponent(enrollmentId)}`, {
    credentials: 'same-origin',
  }).then((response) => readJsonResponse<AgentEnrollment>(response))
}

export function getAgentApprovalPreview(agentId: string, userCode: string): Promise<AgentApprovalPreview> {
  const query = new URLSearchParams({ user_code: userCode })
  return fetch(`/api/account/agent-approvals/${encodeURIComponent(agentId)}?${query.toString()}`, {
    credentials: 'same-origin',
  }).then((response) => readJsonResponse<AgentApprovalPreview>(response))
}

export function approveAgentEnrollment(enrollmentId: string): Promise<{ agent: Agent }> {
  return fetch(`/api/account/agent-enrollments/${encodeURIComponent(enrollmentId)}/decision`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'identity', decision: 'approve' }),
  }).then((response) => readJsonResponse<{ agent: Agent }>(response))
}

export function deleteAgent(agentId: string) {
  return fetch(`/api/account/agents/${encodeURIComponent(agentId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  }).then((response) => {
    if (!response.ok) return readJsonResponse<never>(response)
  })
}

export function activateAgent(agentId: string) {
  return fetch(`/api/account/agents/${encodeURIComponent(agentId)}/activation`, {
    method: 'PUT',
    credentials: 'same-origin',
  }).then((response) => {
    if (!response.ok) return readJsonResponse<never>(response)
  })
}

export function deactivateAgent(agentId: string) {
  return fetch(`/api/account/agents/${encodeURIComponent(agentId)}/activation`, {
    method: 'DELETE',
    credentials: 'same-origin',
  }).then((response) => {
    if (!response.ok) return readJsonResponse<never>(response)
  })
}

export function listExternalApiResources() {
  return fetch('/api/account/api-resources', { credentials: 'same-origin' }).then((response) =>
    readJsonResponse<ConnectableApiResourcesResponse>(response),
  )
}

export function listAccountConnections() {
  return fetch('/api/account/account-connections', { credentials: 'same-origin' }).then((response) =>
    readJsonResponse<{
      items: AccountConnection[]
      pagination: import('@shared/api/pagination').PaginationMetadata
    }>(response),
  )
}

export function listApprovalAccountConnections(approvalToken: string) {
  return fetch(`/api/account/account-connections?approvalToken=${encodeURIComponent(approvalToken)}`, {
    credentials: 'same-origin',
  }).then((response) =>
    readJsonResponse<{
      items: AccountConnection[]
      pagination: import('@shared/api/pagination').PaginationMetadata
    }>(response),
  )
}

export function createAccountConnection(input: CreateAccountConnection) {
  return fetch('/api/account/account-connections', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((response) => readJsonResponse<AccountConnection>(response))
}

export function revokeAccountConnection(connectionId: string) {
  return fetch(`/api/account/account-connections/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  }).then((response) => {
    if (!response.ok) return readJsonResponse<never>(response)
  })
}

export function getAgentResourceApproval(token: string) {
  return fetch(`/api/account/access-requests?approvalToken=${encodeURIComponent(token)}`, {
    credentials: 'same-origin',
  })
    .then((response) =>
      readJsonResponse<{
        items: AccessRequestApproval[]
        pagination: import('@shared/api/pagination').PaginationMetadata
      }>(response),
    )
    .then((result) => result.items[0]!)
}

export function listApprovalAuthorizationDetailCatalog(
  requestId: string,
  approvalToken: string,
  pagination: PaginationQuery = { page: 1, pageSize: 100 },
) {
  const query = new URLSearchParams({
    approvalToken,
    page: String(pagination.page),
    pageSize: String(pagination.pageSize),
  })
  return fetch(`/api/account/access-requests/${encodeURIComponent(requestId)}/authorization-detail-catalog?${query}`, {
    credentials: 'same-origin',
  }).then((response) =>
    readJsonResponse<{
      items: AuthorizationDetailCatalogEntry[]
      pagination: import('@shared/api/pagination').PaginationMetadata
    }>(response),
  )
}

export function listAgentResourceRequests() {
  return fetch('/api/account/access-requests', { credentials: 'same-origin' }).then((response) =>
    readJsonResponse<{
      items: AccessRequestApproval[]
      pagination: import('@shared/api/pagination').PaginationMetadata
    }>(response),
  )
}

export function decideAccountAgentResourceRequest(requestId: string, input: DecideAccessRequest) {
  return fetch(`/api/account/access-requests/${encodeURIComponent(requestId)}/decision`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((response) => readJsonResponse<AccessRequest>(response))
}

export function decideAgentResourceApproval(requestId: string, token: string, input: DecideAccessRequest) {
  return fetch(`/api/account/access-requests/${encodeURIComponent(requestId)}/decision`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approvalToken: token, ...input }),
  }).then((response) => readJsonResponse<AccessRequest>(response))
}

export function getAccountSecurity() {
  return readRpcResponse(apiClient.api.account.security.$get())
}

export function startTotpEnrollment(input: SecurityTotpEnrollmentInput) {
  return readRpcResponse(apiClient.api.account.security.mfa['totp-enrollment'].$post({ json: input }))
}

export function verifyTotp(input: SecurityTotpVerificationInput) {
  return readRpcResponse(apiClient.api.account.security.mfa['totp-verification'].$post({ json: input }))
}

export function disableTotp(input: SecurityTotpDisableInput) {
  return readRpcResponse(apiClient.api.account.security.mfa.totp.$delete({ json: input }))
}

function readAuthClientResult<T>(
  result: { data: T; error: null } | { data: null; error: { message?: string; status?: number; statusText?: string } },
): T {
  if (result.error) {
    throw new ApiRequestError(
      result.error.message ?? result.error.statusText ?? 'Account request failed.',
      result.error.status ?? 500,
    )
  }
  return result.data
}

export function listPasskeys() {
  return readRpcResponse(apiClient.api.account.security.passkeys.$get())
}

export async function createPasskeyRegistrationOptions(input: SecurityPasskeyRegistrationOptionsInput) {
  const query = new URLSearchParams()
  if (input.name) query.set('name', input.name)
  if (input.authenticatorAttachment) query.set('authenticatorAttachment', input.authenticatorAttachment)
  if (input.context) query.set('context', input.context)

  return readJsonResponse<unknown>(
    await fetch(`/api/auth/passkey/generate-register-options${query.size ? `?${query}` : ''}`, {
      method: 'GET',
      credentials: 'same-origin',
    }),
  )
}

export async function verifyPasskeyRegistration(input: Record<string, unknown>) {
  return readJsonResponse<unknown>(
    await fetch('/api/auth/passkey/verify-registration', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export function deletePasskey(id: string) {
  return readRpcResponse(apiClient.api.account.security.passkeys[':id'].$delete({ param: { id } }))
}

export function revokeOtherSessions() {
  return readRpcResponse(apiClient.api.account.security.sessions.$delete())
}

export function revokeSession(sessionId: string) {
  return readRpcResponse(apiClient.api.account.security.sessions[':sessionId'].$delete({ param: { sessionId } }))
}
