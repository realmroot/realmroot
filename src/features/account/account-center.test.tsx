import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountCenter, AccountCenterPage } from './account-center'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('account center', () => {
  it('loads profile, security, session, connection, and application sections', async () => {
    mockAccountFetch({ image: 'https://auth.example.com/api/assets/avatar.png' })

    render(<AccountCenterPage />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/account/profile')
    expect(screen.getByRole('link', { name: 'Security' }).getAttribute('href')).toBe('/account/security')
    expect(screen.getByRole('link', { name: 'Linked accounts' }).getAttribute('href')).toBe('/account/linked-accounts')
    expect(screen.getByRole('link', { name: 'Sessions' }).getAttribute('href')).toBe('/account/sessions')
    expect(screen.getByRole('link', { name: 'Authorized apps' }).getAttribute('href')).toBe('/account/authorized-apps')

    await waitFor(() => expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Jane Stone'))
    expect(document.querySelector('img.assetPreview')?.getAttribute('width')).toBe('64')
    expect(document.querySelector('img.assetPreview')?.getAttribute('height')).toBe('64')
  })

  it('updates profile, email, and password from the profile section', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterPage />)

    fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Jane Updated' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          {
            path: '/api/account/profile',
            method: 'PATCH',
            body: { displayName: 'Jane Updated', username: null, avatarAssetId: null },
          },
          {
            path: '/api/account/email/change',
            method: 'POST',
            body: { email: 'new@example.com', callbackURL: 'http://localhost:3000/email-verification' },
          },
          {
            path: '/api/account/password/change',
            method: 'POST',
            body: {
              currentPassword: 'old-password',
              newPassword: 'new-password',
              revokeOtherSessions: true,
            },
          },
        ]),
      )
    })
  })

  it('uploads an avatar from the profile section', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterPage />)

    const avatarInput = (await screen.findByLabelText('Avatar image')) as HTMLInputElement
    fireEvent.change(avatarInput, {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/account/avatar',
        method: 'POST',
        body: '[form-data]',
      })
    })
  })

  it('shows TOTP enrollment setup data before verification', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenter section="security" />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enroll authenticator app' }))

    expect(await screen.findByText('Authenticator setup')).toBeTruthy()
    expect(screen.getByAltText('Authenticator app QR code').getAttribute('width')).toBe('168')
    expect(screen.getByAltText('Authenticator app QR code').getAttribute('height')).toBe('168')
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

    render(<AccountCenter section="security" />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
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

  it('manages MFA verification, linked accounts, sessions, passkeys, and application consent display', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenter section="security" />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Laptop key')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    clickAndConfirm('Disable MFA', 'Disable authenticator app')
    clickAndConfirm('Remove', 'Remove passkey')

    cleanup()
    render(<AccountCenter section="linked-accounts" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('google')).toBeTruthy()
    clickAndConfirm('Unlink', 'Unlink account')

    cleanup()
    render(<AccountCenter section="sessions" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Chrome on macOS')).toBeTruthy()
    clickAndConfirm('Revoke other sessions', 'Revoke sessions')
    clickAndConfirm('Revoke', 'Revoke session')

    cleanup()
    render(<AccountCenter section="authorized-apps" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Customer Portal')).toBeTruthy()
    expect(screen.getByText(/openid, email/)).toBeTruthy()
    clickAndConfirm('Revoke', 'Revoke access')

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          {
            path: '/api/account/security/mfa/totp-verification',
            method: 'POST',
            body: { code: '123456', trustDevice: true },
          },
          { path: '/api/account/security/mfa/totp', method: 'DELETE', body: { password: '' } },
          { path: '/api/account/security/passkeys/passkey-1', method: 'DELETE', body: null },
          { path: '/api/account/linked-accounts/google?accountId=google-account-1', method: 'DELETE', body: null },
          { path: '/api/account/security/sessions', method: 'DELETE', body: null },
          { path: '/api/account/security/sessions/session-1', method: 'DELETE', body: null },
          { path: '/api/account/applications/consent-1', method: 'DELETE', body: null },
        ]),
      )
    })
  })

  it('does not run destructive account mutations when confirmation is canceled', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenter section="authorized-apps" />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(requests.some((request) => request.method === 'DELETE')).toBe(false))
  })

  it('surfaces load and mutation failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const path = String(input)
      if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (path === '/api/account/profile' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Profile rejected.' } }, 400))
      }
      if (path === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile() }))
      if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
      if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
      if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
      if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security: security() }))
      if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<AccountCenterPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Profile rejected.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      if (String(input) === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      return Promise.resolve(jsonResponse({ error: { message: 'Account unavailable.' } }, 503))
    })

    render(<AccountCenterPage />)

    expect(await screen.findByText('Account unavailable.')).toBeTruthy()
  })

  it('renders account center fallback states and alternate security enrollment fields', async () => {
    const requests: RequestRecord[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (method !== 'GET') requests.push({ path, method, body })
      if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (path === '/api/account/profile') {
        return Promise.resolve(jsonResponse({ user: { ...profile(), emailVerified: false, username: null } }))
      }
      if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
      if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
      if (path === '/api/account/sessions') {
        return Promise.resolve(jsonResponse({ sessions: [{ ...sessions()[0], ipAddress: null, userAgent: null }] }))
      }
      if (path === '/api/account/security') {
        return Promise.resolve(jsonResponse({ security: { ...security(), mfa: { enabled: true, factors: ['totp'] } } }))
      }
      if (path === '/api/account/security/passkeys') {
        return Promise.resolve(jsonResponse({ passkeys: [{ ...passkeys()[0], name: null, backedUp: false }] }))
      }
      if (path === '/api/account/security/mfa/totp-enrollment') {
        return Promise.resolve(
          jsonResponse({
            qrCodeUrl: 'data:image/png;base64,ZmFrZQ',
            totpUri: 'otpauth://totp/Acme:jane@example.com?secret=XYZ789',
            secret: 'XYZ789',
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
            excludeCredentials: [{ id: 'CgsM', type: 'public-key', transports: ['internal'] }],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue({
          ...passkeyCredential(),
          response: {
            attestationObject: new Uint8Array([4, 5, 6]).buffer,
            clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
          },
        }),
      },
    })

    render(<AccountCenter section="profile" />)

    expect(await screen.findByText('Verification required')).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe(''))
    cleanup()
    render(<AccountCenter section="security" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Enabled')).toBeTruthy()
    expect(screen.getByText('Unnamed passkey')).toBeTruthy()
    expect(screen.getByText('singleDevice')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enroll authenticator app' }))
    expect(await screen.findByText('otpauth://totp/Acme:jane@example.com?secret=XYZ789')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/account/security/passkeys/registration-options',
        method: 'POST',
        body: {},
      })
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: '/api/account/security/passkeys/registration-verification',
        }),
      )
    })

    cleanup()
    render(<AccountCenter section="sessions" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText(/Unknown device/)).toBeTruthy()
    expect(screen.getByText(/No IP/)).toBeTruthy()
    cleanup()
    render(<AccountCenter section="linked-accounts" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('No linked social accounts.')).toBeTruthy()
    cleanup()
    render(<AccountCenter section="authorized-apps" />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('No application consents.')).toBeTruthy()
  })
})

type RequestRecord = {
  path: string
  method: string
  body: unknown
}

type MockProfile = Omit<ReturnType<typeof profile>, 'image'> & {
  image: string | null
}

function clickAndConfirm(triggerName: string, confirmName: string) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }))
  const buttons = screen.getAllByRole('button', { name: confirmName })
  fireEvent.click(buttons.at(-1) as HTMLButtonElement)
}

function mockAccountFetch(profileOverrides: Partial<MockProfile> = {}) {
  const requests: RequestRecord[] = []
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body instanceof FormData ? '[form-data]' : init?.body ? JSON.parse(String(init.body)) : null
    if (method !== 'GET') requests.push({ path, method, body })
    if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
    if (path === '/api/account/profile')
      return Promise.resolve(jsonResponse({ user: { ...profile(), ...profileOverrides } }))
    if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: linkedAccounts() }))
    if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: applications() }))
    if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: sessions() }))
    if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security: security() }))
    if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: passkeys() }))
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
    if (path === '/api/account/avatar') {
      return Promise.resolve(
        jsonResponse(
          {
            asset: {
              id: 'asset-1',
              publicUrl: 'https://auth.example.com/api/assets/asset-1',
              contentType: 'image/png',
              byteSize: 6,
              checksumSha256: 'checksum-1',
            },
          },
          201,
        ),
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

function linkedAccounts() {
  return [
    { id: 'linked-1', accountId: 'google-account-1', providerId: 'google', createdAt: '2026-01-01T00:00:00.000Z' },
  ]
}

function applications() {
  return [
    {
      id: 'consent-1',
      applicationName: 'Customer Portal',
      applicationSlug: 'customer-portal',
      scopes: ['openid', 'email'],
      grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
    },
  ]
}

function sessions() {
  return [
    {
      id: 'session-1',
      expiresAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      ipAddress: '127.0.0.1',
      userAgent: 'Chrome on macOS',
    },
  ]
}

function passkeys() {
  return [
    {
      id: 'passkey-1',
      name: 'Laptop key',
      deviceType: 'singleDevice',
      backedUp: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
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
