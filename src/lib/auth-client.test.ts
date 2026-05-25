import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiRequestError } from './api'
import {
  approveAgentCapability,
  nativeAuth,
  requestEmailOtp,
  requestEmailOtpPasswordReset,
  requestEmailVerification,
  requestPasswordReset,
  requestPhoneOtp,
  requestWalletNonce,
  resetPassword,
  resetPasswordWithEmailOtp,
  signInWithEmailOtp,
  signInWithOneTap,
  signInWithPassword,
  signInWithSocial,
  signInWithUsername,
  signInWithWallet,
  signOut,
  signUp,
  verifyEmail,
  verifyEmailOtp,
  verifyPhoneNumber,
  verifySignInTotp,
} from './auth-client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('native auth client', () => {
  it('posts Better Auth native JSON requests', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      requests.push({ url: String(input), init })
      return Promise.resolve(jsonResponse({ url: 'https://github.com/oauth' }))
    })

    await expect(signInWithSocial({ provider: 'github', callbackURL: '/account' })).resolves.toEqual({
      url: 'https://github.com/oauth',
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('/api/auth/sign-in/social')
    expect(requests[0]?.init?.method).toBe('POST')
    expect(requests[0]?.init?.body).toBe(JSON.stringify({ provider: 'github', callbackURL: '/account' }))
  })

  it('uses native GET requests for token email verification', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ status: true }))

    await verifyEmail({ token: 'token-1', callbackURL: '/account' })

    expect(window.fetch).toHaveBeenCalledWith('/api/auth/verify-email?token=token-1&callbackURL=%2Faccount', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    })
  })

  it('surfaces Better Auth error messages', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ error: { message: 'Invalid credentials' } }, 401))

    await expect(nativeAuth('/sign-in/email', { email: 'jane@example.com', password: 'wrong' })).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 401,
      message: 'Invalid credentials',
    } satisfies Partial<ApiRequestError>)
  })

  it('accepts empty native auth responses', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    await expect(signOut()).resolves.toEqual({})
  })

  it('uses native error fallbacks for empty and string error bodies', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Email is invalid' }, 400))
      .mockResolvedValueOnce(jsonResponse({ detail: 'unknown shape' }, 418))

    await expect(nativeAuth('/sign-in/email', { email: 'jane@example.com' })).rejects.toMatchObject({
      message: 'Request failed with status 500.',
      status: 500,
    } satisfies Partial<ApiRequestError>)
    await expect(nativeAuth('/sign-in/email', { email: 'jane@example.com' })).rejects.toMatchObject({
      message: 'Email is invalid',
      status: 400,
    } satisfies Partial<ApiRequestError>)
    await expect(nativeAuth('/sign-in/email', { email: 'jane@example.com' })).rejects.toMatchObject({
      message: '{"detail":"unknown shape"}',
      status: 418,
    } satisfies Partial<ApiRequestError>)
  })

  it('maps hosted auth actions to native Better Auth endpoints', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    await signInWithPassword({ email: 'jane@example.com', password: 'password-1' })
    await signInWithUsername({ username: 'jane', password: 'password-1' })
    await signOut()
    await signUp({ email: 'jane@example.com', name: 'Jane', password: 'password-1', username: 'jane' })
    await requestPasswordReset({ email: 'jane@example.com', redirectTo: '/forgot-password' })
    await resetPassword({ token: 'token-1', newPassword: 'new-password' })
    await requestEmailVerification({ email: 'jane@example.com', callbackURL: '/account' })
    await requestEmailOtp({ email: 'jane@example.com', type: 'sign-in' })
    await signInWithEmailOtp({ email: 'jane@example.com', otp: '123456' })
    await requestPhoneOtp({ phoneNumber: '+15555550123' })
    await verifyPhoneNumber({ phoneNumber: '+15555550123', code: '123456' })
    await verifyEmailOtp({ email: 'jane@example.com', otp: '123456' })
    await requestEmailOtpPasswordReset({ email: 'jane@example.com' })
    await resetPasswordWithEmailOtp({ email: 'jane@example.com', otp: '123456', password: 'new-password' })
    await requestWalletNonce({ walletAddress: '0x0000000000000000000000000000000000000001', chainId: 1 })
    await signInWithWallet({
      message: 'Sign this message.',
      signature: '0xsignature',
      walletAddress: '0x0000000000000000000000000000000000000001',
      chainId: 1,
    })
    await signInWithOneTap({ idToken: 'id-token-1' })
    await verifySignInTotp({ code: '123456', trustDevice: true })
    await approveAgentCapability({ agentId: 'agent-1', userCode: 'ABCD-1234' })
    await approveAgentCapability({
      agentId: 'agent-2',
      userCode: 'WXYZ-9876',
      capabilities: ['account.profile.read'],
    })

    expect(requests.map((request) => request.url)).toEqual([
      '/api/auth/sign-in/email',
      '/api/auth/sign-in/username',
      '/api/auth/sign-out',
      '/api/auth/sign-up/email',
      '/api/auth/request-password-reset',
      '/api/auth/reset-password',
      '/api/auth/send-verification-email',
      '/api/auth/email-otp/send-verification-otp',
      '/api/auth/sign-in/email-otp',
      '/api/auth/phone-number/send-otp',
      '/api/auth/phone-number/verify',
      '/api/auth/email-otp/verify-email',
      '/api/auth/email-otp/request-password-reset',
      '/api/auth/email-otp/reset-password',
      '/api/auth/siwe/nonce',
      '/api/auth/siwe/verify',
      '/api/auth/one-tap/callback',
      '/api/auth/two-factor/verify-totp',
      '/api/auth/agent/approve-capability',
      '/api/auth/agent/approve-capability',
    ])
    expect(requests.at(-1)?.body).toEqual({
      agent_id: 'agent-2',
      user_code: 'WXYZ-9876',
      action: 'approve',
      capabilities: ['account.profile.read'],
    })
    expect(requests.at(-2)?.body).toEqual({
      agent_id: 'agent-1',
      user_code: 'ABCD-1234',
      action: 'approve',
    })
  })

  it('falls back to plain response text for non-JSON native errors', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response('upstream unavailable', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    await expect(nativeAuth('/sign-in/email', { email: 'jane@example.com' })).rejects.toMatchObject({
      message: 'upstream unavailable',
      status: 503,
    } satisfies Partial<ApiRequestError>)
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
