import { agentAuthClient } from '@better-auth/agent-auth/client'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { passkeyClient } from '@better-auth/passkey/client'
import { organizationAccessControl, organizationRoles } from '@shared/organization-access'
import { adminClient, emailOTPClient, organizationClient, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ApiRequestError } from './api'
import { i18n } from './i18n'

export const authClient = createAuthClient({
  fetchOptions: {
    customFetchImpl: (...args) => fetch(...args),
  },
  plugins: [
    adminClient(),
    agentAuthClient(),
    emailOTPClient(),
    oauthProviderClient(),
    organizationClient({
      ac: organizationAccessControl,
      roles: organizationRoles,
      teams: { enabled: true },
    }),
    passkeyClient(),
    usernameClient(),
  ],
})

type NativeAuthResult = {
  token?: string | null
  redirect?: boolean
  url?: string
  redirectTo?: string
  callbackURL?: string
  twoFactorRedirect?: boolean
  twoFactorMethods?: string[]
}

export function completeOAuthConsent(input: { accept: boolean; scope?: string; oauthQuery: string }) {
  return nativeAuth('/oauth2/consent', {
    accept: input.accept,
    ...(input.scope ? { scope: input.scope } : {}),
    oauth_query: input.oauthQuery,
  })
}

export function signInWithPassword(input: {
  email: string
  password: string
  callbackURL?: string
  rememberMe?: boolean
  captchaToken?: string
}) {
  return nativeAuth('/sign-in/email', input)
}

export function signInWithUsername(input: {
  username: string
  password: string
  callbackURL?: string
  rememberMe?: boolean
  captchaToken?: string
}) {
  return nativeAuth('/sign-in/username', input)
}

export function signOut() {
  return nativeAuth('/sign-out', {})
}

export function signUp(input: {
  email: string
  password: string
  name: string
  username?: string
  callbackURL?: string
  rememberMe?: boolean
  captchaToken?: string
}) {
  return nativeAuth('/sign-up/email', input)
}

export function requestEmailVerification(input: { email: string; callbackURL?: string }) {
  return nativeAuth('/send-verification-email', input)
}

export function verifyEmail(input: { token: string; callbackURL?: string }) {
  const params = new URLSearchParams({ token: input.token })
  if (input.callbackURL) params.set('callbackURL', input.callbackURL)
  return nativeAuth(`/verify-email?${params.toString()}`, undefined, 'GET')
}

export function requestEmailOtp(input: {
  email: string
  type: 'sign-in' | 'email-verification' | 'forget-password'
  captchaToken?: string
}) {
  return nativeAuth('/email-otp/send-verification-otp', input)
}

export function signInWithEmailOtp(input: { email: string; otp: string; name?: string }) {
  return nativeAuth('/sign-in/email-otp', input)
}

export function requestPhoneOtp(input: { phoneNumber: string }) {
  return nativeAuth('/phone-number/send-otp', input)
}

export function verifyPhoneNumber(input: { phoneNumber: string; code: string }) {
  return nativeAuth('/phone-number/verify', input)
}

export function signInWithSocial(input: { provider: string; callbackURL?: string; errorCallbackURL?: string }) {
  return nativeAuth('/sign-in/social', input)
}

export async function signInWithPasskey() {
  const response = await authClient.signIn.passkey()
  if (response.error) {
    throw new ApiRequestError(response.error.message ?? response.error.statusText, response.error.status)
  }
  return response.data ?? {}
}

export function requestWalletNonce(input: { walletAddress: string; chainId: number }) {
  return nativeAuth('/siwe/nonce', input) as Promise<{ nonce: string }>
}

export function signInWithWallet(input: {
  message: string
  signature: string
  walletAddress: string
  chainId: number
  email?: string
}) {
  return nativeAuth('/siwe/verify', input)
}

export function signInWithOneTap(input: { idToken: string }) {
  return nativeAuth('/one-tap/callback', input)
}

export function verifySignInTotp(input: { code: string; trustDevice?: boolean }) {
  return nativeAuth('/two-factor/verify-totp', input)
}

export function decideProtocolAgentEnrollment(input: {
  agentId: string
  userCode: string
  action: 'approve' | 'deny'
}) {
  return postAccount(
    `/api/account/agent-enrollments/${encodeURIComponent(input.agentId)}/decision`,
    {
      kind: 'protocol',
      decision: input.action,
      userCode: input.userCode,
    },
    'PUT',
  )
}

export function verifyDeviceCode(input: { userCode: string }) {
  const params = new URLSearchParams({ user_code: input.userCode })
  return nativeAuth(`/device?${params.toString()}`, undefined, 'GET') as Promise<{
    user_code: string
    status: 'pending' | 'approved' | 'denied'
  }>
}

export function approveDeviceCode(input: { userCode: string }) {
  return nativeAuth('/device/approve', { userCode: input.userCode }) as Promise<{ success: boolean }>
}

export function denyDeviceCode(input: { userCode: string }) {
  return nativeAuth('/device/deny', { userCode: input.userCode }) as Promise<{ success: boolean }>
}

export function verifyEmailOtp(input: { email: string; otp: string }) {
  return nativeAuth('/email-otp/verify-email', input)
}

export function requestEmailOtpPasswordReset(input: { email: string; captchaToken?: string }) {
  return nativeAuth('/email-otp/request-password-reset', input)
}

export function resetPasswordWithEmailOtp(input: { email: string; otp: string; password: string }) {
  return nativeAuth('/email-otp/reset-password', input)
}

export function resetPasswordWithToken(input: { token: string; newPassword: string }) {
  return nativeAuth('/reset-password', input)
}

export async function nativeAuth(
  path: string,
  body?: Record<string, unknown>,
  method = 'POST',
): Promise<NativeAuthResult> {
  const headers = authHeaders(body)
  const response = await fetch(`/api/auth${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  if (response.status === 204) return {}
  return response.json() as Promise<NativeAuthResult>
}

async function postAccount(path: string, body: Record<string, unknown>, method = 'POST') {
  const response = await fetch(path, {
    method,
    headers: authHeaders(body),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  return response.json() as Promise<Record<string, unknown>>
}

function authHeaders(body: Record<string, unknown> | undefined) {
  const headers: Record<string, string> = body ? { 'content-type': 'application/json' } : {}
  if (i18n.language === 'zh') headers['accept-language'] = i18n.language
  return Object.keys(headers).length > 0 ? headers : undefined
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
