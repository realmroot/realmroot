import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountCenterPage } from './account-center'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('account center', () => {
  it('loads profile, security, session, connection, and application sections', async () => {
    mockAccountFetch()

    render(<AccountCenterPage />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Linked accounts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Consented apps' })).toBeTruthy()

    await waitFor(() => expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Jane Stone'))
  })

  it('shows TOTP enrollment setup data before verification', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Security' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enroll authenticator app' }))

    expect(await screen.findByText('Authenticator setup')).toBeTruthy()
    expect(screen.getByText('otpauth://totp/Acme:jane@example.com?secret=ABC123')).toBeTruthy()
    expect(screen.getByText('ABC123')).toBeTruthy()
    expect(requests).toContainEqual({
      path: '/api/account/security/mfa/totp-enrollment',
      body: { password: 'password-1' },
      method: 'POST',
    })
  })

  it('completes passkey registration with WebAuthn create and verification', async () => {
    const requests = mockAccountFetch()
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue(passkeyCredential()),
      },
    })

    render(<AccountCenterPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Security' }))
    fireEvent.change(screen.getByLabelText('Passkey name'), { target: { value: 'MacBook Touch ID' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/account/security/passkeys/registration-options',
        body: { name: 'MacBook Touch ID' },
        method: 'POST',
      })
      expect(requests).toContainEqual({
        path: '/api/account/security/passkeys/registration-verification',
        body: {
          name: 'MacBook Touch ID',
          response: {
            id: 'credential-1',
            rawId: 'AQID',
            type: 'public-key',
            response: {
              attestationObject: 'BAUG',
              clientDataJSON: 'BwgJ',
              transports: ['internal'],
            },
            clientExtensionResults: {},
          },
        },
        method: 'POST',
      })
    })
    expect(navigator.credentials.create).toHaveBeenCalled()
  })
})

type RequestRecord = {
  path: string
  method: string
  body: unknown
}

function mockAccountFetch() {
  const requests: RequestRecord[] = []
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : null
    if (method !== 'GET') requests.push({ path, method, body })
    if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
    if (path === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile() }))
    if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
    if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
    if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
    if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security: security() }))
    if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
    if (path === '/api/account/security/mfa/totp-enrollment') {
      return Promise.resolve(
        jsonResponse({
          qrCode: 'data:image/png;base64,ZmFrZQ',
          totpURI: 'otpauth://totp/Acme:jane@example.com?secret=ABC123',
          secret: 'ABC123',
        }),
      )
    }
    if (path === '/api/account/security/passkeys/registration-options') {
      return Promise.resolve(
        jsonResponse({
          challenge: 'AQID',
          rp: { name: 'Acme ID', id: 'localhost' },
          user: { id: 'BAUG', name: 'jane@example.com', displayName: 'Jane Stone' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        }),
      )
    }
    return Promise.resolve(jsonResponse({ ok: true }))
  })
  return requests
}

function configz() {
  return {
    onboarding: { required: false, href: '/onboarding' },
    signIn: {
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: false,
      magicLinkEnabled: false,
      emailOtpEnabled: false,
      usernameEnabled: true,
      identifierFirst: false,
    },
    branding: {
      logoUrl: null,
      faviconUrl: null,
      primaryColor: '#b42318',
      backgroundColor: '#f7f3ee',
      customCss: null,
    },
    identityProviders: [],
    links: { termsUri: null, privacyUri: null, supportEmail: null },
    copy: {
      productName: 'Acme ID',
      headline: 'Sign in.',
      description: 'Hosted identity.',
    },
    defaults: { applicationId: null, redirectUri: null },
    auth: {
      basePath: '/api/auth',
      signInEmailPath: '/api/auth/sign-in/email',
      signInUsernamePath: '/api/auth/sign-in/username',
      signUpEmailPath: '/api/auth/sign-up/email',
      signOutPath: '/api/auth/sign-out',
      requestPasswordResetPath: '/api/auth/request-password-reset',
      resetPasswordPath: '/api/auth/reset-password',
      sendVerificationEmailPath: '/api/auth/send-verification-email',
      verifyEmailPath: '/api/auth/verify-email',
      magicLinkPath: '/api/auth/sign-in/magic-link',
      emailOtpPath: '/api/auth/email-otp/send-verification-otp',
      emailOtpSignInPath: '/api/auth/sign-in/email-otp',
      emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
      emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
      emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
    },
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
    },
    security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
  }
}

function profile() {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    emailVerified: true,
    displayName: 'Jane Stone',
    username: 'jane',
    avatarAssetId: null,
    image: null,
  }
}

function security() {
  return {
    mfa: { enabled: false, factors: [] },
    passkeys: { enabled: true, count: 0 },
    policy: {
      mfa: { mode: 'optional' },
      passkeys: {
        enabled: true,
        rpName: 'Acme ID',
      },
    },
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function passkeyCredential() {
  return {
    id: 'credential-1',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      attestationObject: new Uint8Array([4, 5, 6]).buffer,
      clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({}),
  }
}
