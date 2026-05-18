import type { HostedConsentApprovalRequest } from '@shared/api/applications'
import type {
  EmailOtpPasswordResetInput,
  EmailOtpPasswordResetRequest,
  EmailOtpRequest,
  EmailOtpSignIn,
  EmailOtpVerification,
  EmailVerificationInput,
  EmailVerificationRequest,
  MagicLinkRequest,
  PasswordResetInput,
  PasswordResetRequest,
  PasswordSignInRequest,
  SignUpRequest,
  UsernameSignInRequest,
} from '@shared/api/experience'
import { type ClientResponse, hc } from 'hono/client'
import type { AppType } from '../../../server/app'

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export const apiClient = hc<AppType>('/')

type SuccessResponseBody<RpcRequest> =
  RpcRequest extends Promise<infer Response>
    ? Response extends ClientResponse<infer Body, infer Status, string>
      ? Status extends 400
        ? never
        : Body
      : never
    : never

export async function readRpcResponse<RpcRequest extends Promise<ClientResponse<unknown, number, string>>>(
  request: RpcRequest,
): Promise<SuccessResponseBody<RpcRequest>> {
  const response = await request
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }

  if (response.status === 204) return undefined as SuccessResponseBody<RpcRequest>

  return (await response.json()) as SuccessResponseBody<RpcRequest>
}

async function responseMessage(response: Pick<Response, 'status' | 'text'>): Promise<string> {
  const text = await response.text()
  if (!text) return `Request failed with status ${response.status}.`

  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string | { message?: string } }
    if (typeof parsed.error === 'string') return parsed.error
    return parsed.message ?? parsed.error?.message ?? text
  } catch {
    return text
  }
}

export function getPlatformStatus() {
  return readRpcResponse(apiClient.api.health.$get())
}

export function getExperienceConfig() {
  return readRpcResponse(apiClient.api.experience.$get())
}

export function getCallbackState(search: string) {
  return readRpcResponse(apiClient.api.experience.callback.$get({ query: query(search) }))
}

export function getConsentRequest(search: string) {
  return readRpcResponse(
    apiClient.api.oauth.consent.$get({
      query: query(search) as { client_id: string; redirect_uri: string; scope?: string; state?: string },
    }),
  )
}

export function createConsent(input: HostedConsentApprovalRequest) {
  return readRpcResponse(apiClient.api.oauth.consent.$post({ json: input }))
}

export function signInWithPassword(input: PasswordSignInRequest) {
  return readRpcResponse(apiClient.api.experience['sign-ins'].password.$post({ json: input }))
}

export function signInWithUsername(input: UsernameSignInRequest) {
  return readRpcResponse(apiClient.api.experience['sign-ins'].username.$post({ json: input }))
}

export function signOut() {
  return readRpcResponse(apiClient.api.experience.session.$delete())
}

export function signUp(input: SignUpRequest) {
  return readRpcResponse(apiClient.api.experience['sign-ups'].$post({ json: input }))
}

export function requestPasswordReset(input: PasswordResetRequest) {
  return readRpcResponse(apiClient.api.experience['password-reset-requests'].$post({ json: input }))
}

export function resetPassword(input: PasswordResetInput) {
  return readRpcResponse(apiClient.api.experience['password-resets'].$post({ json: input }))
}

export function requestEmailVerification(input: EmailVerificationRequest) {
  return readRpcResponse(apiClient.api.experience['email-verification-requests'].$post({ json: input }))
}

export function verifyEmail(input: EmailVerificationInput) {
  return readRpcResponse(apiClient.api.experience['email-verifications'].$post({ json: input }))
}

export function requestMagicLink(input: MagicLinkRequest) {
  return readRpcResponse(apiClient.api.experience['magic-links'].$post({ json: input }))
}

export function requestEmailOtp(input: EmailOtpRequest) {
  return readRpcResponse(apiClient.api.experience['email-otps'].$post({ json: input }))
}

export function signInWithEmailOtp(input: EmailOtpSignIn) {
  return readRpcResponse(apiClient.api.experience['email-otp']['sign-ins'].$post({ json: input }))
}

export function verifyEmailOtp(input: EmailOtpVerification) {
  return readRpcResponse(apiClient.api.experience['email-otp']['email-verifications'].$post({ json: input }))
}

export function requestEmailOtpPasswordReset(input: EmailOtpPasswordResetRequest) {
  return readRpcResponse(apiClient.api.experience['email-otp']['password-reset-requests'].$post({ json: input }))
}

export function resetPasswordWithEmailOtp(input: EmailOtpPasswordResetInput) {
  return readRpcResponse(apiClient.api.experience['email-otp']['password-resets'].$post({ json: input }))
}

function query(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search))
}
