import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { adminClient, emailOTPClient, magicLinkClient, usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ApiRequestError } from './api'

export const authClient = createAuthClient({
  plugins: [adminClient(), emailOTPClient(), magicLinkClient(), oauthProviderClient(), usernameClient()],
})

type NativeAuthResult = {
  url?: string
  redirectTo?: string
  callbackURL?: string
}

export function signInWithPassword(input: {
  email: string
  password: string
  callbackURL?: string
  rememberMe?: boolean
}) {
  return nativeAuth('/sign-in/email', input)
}

export function signInWithUsername(input: {
  username: string
  password: string
  callbackURL?: string
  rememberMe?: boolean
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
}) {
  return nativeAuth('/sign-up/email', input)
}

export function requestPasswordReset(input: { email: string; redirectTo?: string }) {
  return nativeAuth('/request-password-reset', input)
}

export function resetPassword(input: { token: string; newPassword: string }) {
  return nativeAuth('/reset-password', input)
}

export function requestEmailVerification(input: { email: string; callbackURL?: string }) {
  return nativeAuth('/send-verification-email', input)
}

export function verifyEmail(input: { token: string; callbackURL?: string }) {
  const params = new URLSearchParams({ token: input.token })
  if (input.callbackURL) params.set('callbackURL', input.callbackURL)
  return nativeAuth(`/verify-email?${params.toString()}`, undefined, 'GET')
}

export function requestMagicLink(input: {
  email: string
  name?: string
  callbackURL?: string
  newUserCallbackURL?: string
  errorCallbackURL?: string
}) {
  return nativeAuth('/sign-in/magic-link', input)
}

export function requestEmailOtp(input: { email: string; type: 'sign-in' | 'email-verification' | 'forget-password' }) {
  return nativeAuth('/email-otp/send-verification-otp', input)
}

export function signInWithEmailOtp(input: { email: string; otp: string; name?: string }) {
  return nativeAuth('/sign-in/email-otp', input)
}

export function signInWithSocial(input: { provider: string; callbackURL?: string }) {
  return nativeAuth('/sign-in/social', input)
}

export function verifyEmailOtp(input: { email: string; otp: string }) {
  return nativeAuth('/email-otp/verify-email', input)
}

export function requestEmailOtpPasswordReset(input: { email: string }) {
  return nativeAuth('/email-otp/request-password-reset', input)
}

export function resetPasswordWithEmailOtp(input: { email: string; otp: string; password: string }) {
  return nativeAuth('/email-otp/reset-password', input)
}

export async function nativeAuth(
  path: string,
  body?: Record<string, unknown>,
  method = 'POST',
): Promise<NativeAuthResult> {
  const response = await fetch(`/api/auth${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new ApiRequestError(await responseMessage(response), response.status)
  }
  if (response.status === 204) return {}
  return response.json() as Promise<NativeAuthResult>
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
