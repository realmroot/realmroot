import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

const base = 'http://localhost:3000'

export type AccountStore = ReturnType<typeof createAccountStore>

export function createAccountStore() {
  return {
    profile: {
      id: 'user-1',
      email: 'jane@example.com',
      emailVerified: true,
      displayName: 'Jane Stone',
      username: 'jane' as string | null,
      avatarAssetId: null as string | null,
      image: null as string | null,
      role: 'user' as string | null,
    },
    security: {
      mfa: { enabled: false, factors: [] as unknown[] },
      passkeys: { enabled: true, count: 0 },
      policy: { mfa: { mode: 'optional' }, passkeys: { enabled: true, rpName: 'FlareAuth' } },
    },
    passkeys: [] as Array<{
      id: string
      name: string | null
      deviceType: string
      backedUp: boolean
      createdAt: string | null
    }>,
    sessions: [] as Array<{
      id: string
      userAgent: string | null
      ipAddress: string | null
      expiresAt: string
      current?: boolean
    }>,
    linkedAccounts: [] as Array<{
      id: string
      accountId: string
      providerId: string
      createdAt: string
    }>,
    applications: [] as Array<{
      id: string
      applicationName: string
      scopes: string[]
      grantedAt: string
    }>,
    agents: [] as Array<{
      id: string
      name: string
      status: string
      host: { id: string; name: string | null }
      capabilityGrants: Array<{ id: string; capability: string }>
    }>,
  }
}

export function configz(overrides: Partial<ReturnType<typeof baseConfigz>> = {}) {
  return { ...baseConfigz(), ...overrides }
}

function baseConfigz() {
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

type Handlers = Parameters<typeof setupServer>

export function accountHandlers(store: AccountStore, config: ReturnType<typeof configz> = configz()): Handlers {
  return [
    http.get(`${base}/api/configz`, () => HttpResponse.json(config)),
    http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: store.profile })),
    http.patch(`${base}/api/account/profile`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      Object.assign(store.profile, body)
      return HttpResponse.json({ user: store.profile })
    }),
    http.get(`${base}/api/account/security`, () => HttpResponse.json({ security: store.security })),
    http.get(`${base}/api/account/security/passkeys`, () => HttpResponse.json({ passkeys: store.passkeys })),
    http.get(`${base}/api/account/sessions`, () => HttpResponse.json({ sessions: store.sessions })),
    http.get(`${base}/api/account/linked-accounts`, () => HttpResponse.json({ accounts: store.linkedAccounts })),
    http.get(`${base}/api/account/applications`, () => HttpResponse.json({ applications: store.applications })),
    http.get(`${base}/api/account/agents`, () => HttpResponse.json({ agents: store.agents })),
  ] as unknown as Handlers
}

export function createAccountServer(store: AccountStore, config?: ReturnType<typeof configz>) {
  return setupServer(...(accountHandlers(store, config) as unknown as Parameters<typeof setupServer>))
}

export function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}

export const json = HttpResponse.json
export { base, HttpResponse, http }
