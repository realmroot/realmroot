import type {
  AccountEmailChangeConfirmInput,
  AccountEmailChangeInput,
  AccountPasswordChangeInput,
  AccountProfileUpdateInput,
  AccountWalletAddressLinkInput,
} from '@shared/api/account'
import type {
  AccessRequest,
  AccountConnection,
  Agent,
  AgentEnrollment,
  ConnectableApiResourcesResponse,
  CreateAccountConnection,
  DecideAccessRequest,
} from '@shared/api/agent-api'
import type {
  SecurityPasskeyRegistrationOptionsInput,
  SecurityTotpDisableInput,
  SecurityTotpEnrollmentInput,
  SecurityTotpVerificationInput,
} from '@shared/api/security'
import { apiClient, readJsonResponse, readRpcResponse, uploadApiFile } from '@/lib/api'
import { nativeAuth } from '@/lib/auth-client'

export function getAccountProfile() {
  return readRpcResponse(apiClient.api.account.profile.$get())
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

export function listConsentedApplications() {
  return readRpcResponse(apiClient.api.account.applications.$get())
}

export function revokeApplicationConsent(consentId: string) {
  return readRpcResponse(apiClient.api.account.applications[':consentId'].$delete({ param: { consentId } }))
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

export function getAgentEnrollment(enrollmentId: string): Promise<AgentEnrollment> {
  return fetch(`/api/account/agent-enrollments/${encodeURIComponent(enrollmentId)}`, {
    credentials: 'same-origin',
  }).then((response) => readJsonResponse<AgentEnrollment>(response))
}

export function approveAgentEnrollment(enrollmentId: string): Promise<{ agent: Agent }> {
  return fetch(`/api/account/agent-enrollments/${encodeURIComponent(enrollmentId)}/decision`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'identity', decision: 'approve' }),
  }).then((response) => readJsonResponse<{ agent: Agent }>(response))
}

export function retireAgent(agentId: string) {
  return fetch(`/api/account/agents/${encodeURIComponent(agentId)}`, {
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
        items: AccessRequest[]
        pagination: import('@shared/api/pagination').PaginationMetadata
      }>(response),
    )
    .then((result) => result.items[0]!)
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
