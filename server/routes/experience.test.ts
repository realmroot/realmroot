import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import { createExperienceRoutes } from './experience'

describe('experience routes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('serves hosted auth config and callback state through the app route', async () => {
    const auth = createAuthMock()
    const app = createExperienceRoutes(auth.api, createExperienceServiceMock())
    const configResponse = await app.request('/')
    const callbackResponse = await app.request(
      '/callback?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )

    expect(configResponse.status).toBe(200)
    await expect(configResponse.json()).resolves.toMatchObject({
      signIn: {
        passwordEnabled: true,
        signupEnabled: true,
        magicLinkEnabled: true,
        emailOtpEnabled: true,
        usernameEnabled: true,
      },
      branding: {
        logoUrl: null,
        faviconUrl: null,
      },
    })
    expect(callbackResponse.status).toBe(200)
    await expect(callbackResponse.json()).resolves.toMatchObject({
      state: 'state-1',
      consent: {
        clientId: 'client-1',
        redirectUri: 'https://client.example.com/callback',
      },
    })
  })

  it('delegates direct hosted auth flows to Better Auth APIs', async () => {
    const auth = createAuthMock()
    const app = createApp(auth, { experienceServiceFactory: createExperienceServiceMock() })
    const headers = { 'content-type': 'application/json' }

    const signInResponse = await app.request('/api/experience/sign-ins/password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'password-1',
        callbackURL: 'https://app.example.com',
        rememberMe: true,
      }),
    })
    await app.request('/api/experience/sign-ins/username', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'Ada', password: 'password-1' }),
    })
    await app.request('/api/experience/sign-ups', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'password-1',
        name: 'Ada Lovelace',
        username: 'Ada',
      }),
    })
    await app.request('/api/experience/session', { method: 'DELETE', headers })

    expect(signInResponse.headers.get('set-cookie')).toBe('session=token-1')
    expect(auth.api.signInEmail).toHaveBeenCalledWith({
      body: {
        email: 'ada@example.com',
        password: 'password-1',
        callbackURL: 'https://app.example.com',
        rememberMe: true,
      },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.signInUsername).toHaveBeenCalledWith({
      body: {
        username: 'ada',
        password: 'password-1',
      },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.signUpEmail).toHaveBeenCalledWith({
      body: {
        email: 'ada@example.com',
        password: 'password-1',
        name: 'Ada Lovelace',
        username: 'ada',
      },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.signOut).toHaveBeenCalledWith({ headers: expect.any(Headers), asResponse: true })
  })

  it('delegates verification, password reset, magic link, email OTP, and username availability flows', async () => {
    const auth = createAuthMock()
    const app = createApp(auth, { experienceServiceFactory: createExperienceServiceMock() })
    const headers = { 'content-type': 'application/json' }

    await app.request('/api/experience/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', redirectTo: 'https://app.example.com/reset' }),
    })
    await app.request('/api/experience/password-resets', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'reset-token', newPassword: 'new-password' }),
    })
    await app.request('/api/experience/email-verification-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', callbackURL: 'https://app.example.com/verified' }),
    })
    await app.request('/api/experience/email-verifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: 'verify-token', callbackURL: 'https://app.example.com/verified' }),
    })
    await app.request('/api/experience/magic-links', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', callbackURL: 'https://app.example.com' }),
    })
    await app.request('/api/experience/email-otps', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', type: 'sign-in' }),
    })
    await app.request('/api/experience/email-otp/sign-ins', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', otp: '123456' }),
    })
    await app.request('/api/experience/email-otp/email-verifications', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', otp: '123456' }),
    })
    await app.request('/api/experience/email-otp/password-reset-requests', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com' }),
    })
    await app.request('/api/experience/email-otp/password-resets', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'ada@example.com', otp: '123456', password: 'new-password' }),
    })
    await app.request('/api/experience/usernames/availability', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: 'Ada' }),
    })

    expect(auth.api.requestPasswordReset).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', redirectTo: 'https://app.example.com/reset' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.resetPassword).toHaveBeenCalledWith({
      body: { token: 'reset-token', newPassword: 'new-password' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.sendVerificationEmail).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', callbackURL: 'https://app.example.com/verified' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.verifyEmail).toHaveBeenCalledWith({
      query: { token: 'verify-token', callbackURL: 'https://app.example.com/verified' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.signInMagicLink).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', callbackURL: 'https://app.example.com' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.sendVerificationOTP).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', type: 'sign-in' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.signInEmailOTP).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', otp: '123456' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.verifyEmailOTP).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', otp: '123456' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.requestPasswordResetEmailOTP).toHaveBeenCalledWith({
      body: { email: 'ada@example.com' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.resetPasswordEmailOTP).toHaveBeenCalledWith({
      body: { email: 'ada@example.com', otp: '123456', password: 'new-password' },
      headers: expect.any(Headers),
      asResponse: true,
    })
    expect(auth.api.isUsernameAvailable).toHaveBeenCalledWith({
      body: { username: 'ada' },
      headers: expect.any(Headers),
      asResponse: true,
    })
  })

  it('returns Better Auth response headers and redirects from hosted wrappers', async () => {
    const auth = createAuthMock()
    auth.api.verifyEmail.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/done' } }))

    const response = await createApp(auth, { experienceServiceFactory: createExperienceServiceMock() }).request(
      '/api/experience/email-verifications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'verify-token', callbackURL: '/done' }),
      },
    )

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/done')
  })

  it('rejects invalid hosted auth request bodies before Better Auth delegation', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, { experienceServiceFactory: createExperienceServiceMock() }).request(
      '/api/experience/sign-ins/password',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-email', password: '' }),
      },
    )

    expect(response.status).toBe(400)
    expect(auth.api.signInEmail).not.toHaveBeenCalled()
  })

  it('enforces disabled hosted auth methods before Better Auth delegation', async () => {
    const auth = createAuthMock()
    const response = await createApp(auth, {
      experienceServiceFactory: () =>
        createExperienceServiceMock({
          passwordEnabled: false,
          signupEnabled: false,
          magicLinkEnabled: false,
          emailOtpEnabled: false,
          usernameEnabled: false,
        })(),
    }).request('/api/experience/sign-ups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', password: 'password-1', name: 'Ada' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'This sign-in method is not enabled.',
      },
    })
    expect(auth.api.signUpEmail).not.toHaveBeenCalled()
  })

  it('translates Better Auth errors from hosted auth flows', async () => {
    const auth = createAuthMock()
    auth.api.signInMagicLink.mockRejectedValueOnce({
      statusCode: 400,
      body: { message: 'Invalid email.' },
      message: 'Invalid email.',
    })

    const response = await createApp(auth, { experienceServiceFactory: createExperienceServiceMock() }).request(
      '/api/experience/magic-links',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com' }),
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bad_request',
        message: 'Invalid email.',
      },
    })
  })
})

function createAuthMock() {
  return {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
      getSession: vi.fn().mockResolvedValue(null),
      signInEmail: vi.fn().mockResolvedValue(authResponse({ token: 'token-1' }, { 'set-cookie': 'session=token-1' })),
      signInUsername: vi.fn().mockResolvedValue(authResponse({ token: 'token-1' })),
      signUpEmail: vi.fn().mockResolvedValue(authResponse({ token: 'token-1' })),
      signOut: vi.fn().mockResolvedValue(authResponse({ success: true }, { 'set-cookie': 'session=; Max-Age=0' })),
      requestPasswordReset: vi.fn().mockResolvedValue(authResponse({ status: true })),
      resetPassword: vi.fn().mockResolvedValue(authResponse({ status: true })),
      sendVerificationEmail: vi.fn().mockResolvedValue(authResponse({ status: true })),
      verifyEmail: vi.fn().mockResolvedValue(authResponse({ status: true })),
      signInMagicLink: vi.fn().mockResolvedValue(authResponse({ status: true })),
      sendVerificationOTP: vi.fn().mockResolvedValue(authResponse({ success: true })),
      signInEmailOTP: vi.fn().mockResolvedValue(authResponse({ token: 'token-1' })),
      verifyEmailOTP: vi.fn().mockResolvedValue(authResponse({ status: true })),
      requestPasswordResetEmailOTP: vi.fn().mockResolvedValue(authResponse({ success: true })),
      resetPasswordEmailOTP: vi.fn().mockResolvedValue(authResponse({ success: true })),
      isUsernameAvailable: vi.fn().mockResolvedValue(authResponse({ available: true })),
    },
    handler: async () => new Response(null, { status: 204 }),
  }
}

function createExperienceServiceMock(overrides: Partial<ConfigMethods> = {}) {
  const signIn = {
    passwordEnabled: true,
    signupEnabled: true,
    socialLoginEnabled: true,
    magicLinkEnabled: true,
    emailOtpEnabled: true,
    usernameEnabled: true,
    identifierFirst: false,
    ...overrides,
  }

  return () => ({
    getConfig: vi.fn().mockResolvedValue({
      signIn,
      branding: {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        backgroundColor: null,
        customCss: null,
      },
      identityProviders: [],
      links: {
        termsUri: null,
        privacyUri: null,
        supportEmail: null,
      },
      copy: {
        productName: 'FlareAuth',
        headline: 'Sign in to FlareAuth',
        description: 'Use your account to continue securely.',
      },
      defaults: {
        applicationId: null,
        redirectUri: null,
      },
    }),
    getCallbackState: vi.fn().mockResolvedValue({
      state: 'state-1',
      returnTo: 'https://client.example.com/callback',
      error: null,
      consent: {
        clientId: 'client-1',
        redirectUri: 'https://client.example.com/callback',
        href: '/oauth/consent?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
      },
    }),
  })
}

type ConfigMethods = {
  passwordEnabled: boolean
  signupEnabled: boolean
  socialLoginEnabled: boolean
  magicLinkEnabled: boolean
  emailOtpEnabled: boolean
  usernameEnabled: boolean
  identifierFirst: boolean
}

function authResponse(body: unknown, headers: HeadersInit = {}) {
  return Response.json(body, { headers })
}
