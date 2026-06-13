import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountConnectionsPage, AccountProfilePage, AccountSecurityPage } from '@/features/account/account-center'
import {
  asRecord,
  base64UrlToBuffer,
  bufferToBase64Url,
  formatSessionDevice,
  readChainId,
  readFirstString,
  readRedirectUrl,
  readRequiredString,
  readString,
} from '@/features/account/utils'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('account pages', () => {
  it('normalizes account helper values', () => {
    expect(bufferToBase64Url(new Uint8Array([251, 255]).buffer)).toBe('-_8')
    expect(Array.from(new Uint8Array(base64UrlToBuffer('-_8')))).toEqual([251, 255])
    expect(asRecord({ id: 'value' })).toEqual({ id: 'value' })
    expect(asRecord(null)).toEqual({})
    expect(readString('value')).toBe('value')
    expect(readString('')).toBeNull()
    expect(readFirstString(['first'])).toBe('first')
    expect(readFirstString([1])).toBeNull()
    expect(readChainId(1)).toBe(1)
    expect(readChainId('0x2105')).toBe(8453)
    expect(readChainId('10')).toBe(10)
    expect(() => readChainId(null)).toThrow('Wallet did not return a chain ID.')
    expect(readRequiredString('challenge', 'challenge')).toBe('challenge')
    expect(() => readRequiredString('', 'challenge')).toThrow('Passkey registration option challenge is required.')
    expect(readRedirectUrl({ url: '/profile' })).toBe('/profile')
    expect(readRedirectUrl({ redirectTo: '/settings' })).toBe('/settings')
    expect(readRedirectUrl({ callbackURL: '/callback' })).toBe('/callback')
    expect(readRedirectUrl({ url: 1 })).toBeNull()
    expect(formatSessionDevice(null)).toBe('Unknown device')
    expect(formatSessionDevice('Custom Agent')).toBe('Custom Agent')
    expect(formatSessionDevice('Mozilla/5.0 (Mac OS X) Chrome/120')).toBe('Chrome on macOS')
  })

  it('profile page only loads profile-owned account data [spec: account-center/account-section-routes]', async () => {
    const requests = mockAccountFetch()
    renderWithClient(<AccountProfilePage />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    await waitFor(() => expect(requests).toEqual(['/api/configz', '/api/account/profile']))
  })

  it('security page loads security-owned account data', async () => {
    const requests = mockAccountFetch()
    renderWithClient(<AccountSecurityPage />)

    expect(await screen.findByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
    await waitFor(() =>
      expect(requests).toEqual([
        '/api/configz',
        '/api/account/profile',
        '/api/account/security',
        '/api/account/security/passkeys',
        '/api/account/sessions',
      ]),
    )
  })

  it('connections page loads connection-owned account data', async () => {
    const requests = mockAccountFetch()
    renderWithClient(<AccountConnectionsPage />)

    expect(await screen.findByText('GitHub')).toBeTruthy()
    await waitFor(() =>
      expect(requests).toEqual([
        '/api/configz',
        '/api/account/profile',
        '/api/account/linked-accounts',
        '/api/account/applications',
        '/api/account/agents',
      ]),
    )
  })
})

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function mockAccountFetch() {
  const requests: string[] = []
  vi.spyOn(window, 'fetch').mockImplementation((input) => {
    const path = String(input)
    requests.push(path)
    if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
    if (path === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile() }))
    if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security }))
    if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
    if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
    if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: linkedAccounts }))
    if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
    if (path === '/api/account/agents') return Promise.resolve(jsonResponse({ agents: [] }))
    return Promise.resolve(jsonResponse({}))
  })
  return requests
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function configz() {
  return {
    onboarding: { required: false, href: '/onboarding' },
    signIn: {
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: true,
      emailOtpEnabled: true,
      usernameEnabled: true,
      identifierFirst: false,
    },
    builtInProviders: {
      email: { enabled: true },
      phone: { enabled: false },
      web3Wallet: { enabled: true, allowSignUp: true, chains: [1] },
      passkey: { allowSignUp: true },
      oneTap: {
        enabled: false,
        clientId: '',
        autoSelect: false,
        cancelOnTapOutside: true,
        uxMode: 'popup',
        context: 'signin',
        promptBaseDelayMs: 0,
        promptMaxAttempts: 1,
      },
    },
    branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
    identityProviders: [
      { slug: 'github', providerType: 'social', providerId: 'github', displayName: 'GitHub', icon: 'github' },
    ],
    links: { termsUri: null, privacyUri: null, supportEmail: null },
    copy: { productName: 'FlareAuth', headline: 'Sign in', description: 'Secure access' },
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
      emailOtpPath: '/api/auth/email-otp/send-verification-otp',
      emailOtpSignInPath: '/api/auth/sign-in/email-otp',
      emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
      emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
      emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
    },
    oidc: {
      issuer: 'https://auth.example.com',
      discoveryUrl: '/.well-known/openid-configuration',
      authorizationEndpoint: '/oauth2/authorize',
      tokenEndpoint: '/oauth2/token',
      jwksUri: '/jwks',
      userInfoEndpoint: '/userinfo',
      endSessionEndpoint: '/logout',
    },
    security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
    accountCenter: {
      profileEditingEnabled: true,
      displayNameEditable: true,
      usernameEditable: true,
      avatarEditable: true,
      emailChangeEnabled: true,
      passwordChangeEnabled: true,
      connectedAccountsEnabled: true,
      sessionsViewEnabled: true,
      dangerZoneEnabled: false,
    },
    captcha: { enabled: false, provider: 'turnstile', siteKey: '' },
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
    role: 'user',
  }
}

const security = {
  mfa: { enabled: false, factors: [] },
  passkeys: { enabled: true, count: 0 },
  policy: { mfa: { mode: 'optional' }, passkeys: { enabled: true, rpName: 'FlareAuth' } },
}

const linkedAccounts = [
  { id: 'account-1', accountId: 'account-1', providerId: 'github', createdAt: '2026-01-01T00:00:00.000Z' },
]
