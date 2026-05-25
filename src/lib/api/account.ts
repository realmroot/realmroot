import type {
  AccountAgentsResponse,
  AccountEmailChangeConfirmInput,
  AccountEmailChangeInput,
  AccountPasswordChangeInput,
  AccountProfileUpdateInput,
  AccountWalletAddressLinkInput,
} from '@shared/api/account'
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

export async function linkWalletAddress(input: AccountWalletAddressLinkInput) {
  return readJsonResponse<Record<string, unknown>>(
    await fetch('/api/account/wallet-addresses', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
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

export function listAccountAgents(): Promise<AccountAgentsResponse> {
  return readRpcResponse(apiClient.api.account.agents.$get())
}

export function revokeAccountAgent(agentId: string) {
  return readRpcResponse(apiClient.api.account.agents[':agentId'].$delete({ param: { agentId } }))
}

export function revokeAccountAgentCapabilityGrant(grantId: string) {
  return readRpcResponse(apiClient.api.account['agent-capability-grants'][':grantId'].$delete({ param: { grantId } }))
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
