import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const signInWithPasskey = vi.fn()

vi.mock('@/lib/auth-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth-client')>('@/lib/auth-client')
  return { ...actual, signInWithPasskey: () => signInWithPasskey() }
})

import { SignInPage } from '@/features/auth/pages/sign-in'

const configz = {
  onboarding: { required: false, href: '/onboarding' },
  signIn: {
    passwordEnabled: false,
    signupEnabled: false,
    socialLoginEnabled: false,
    emailOtpEnabled: false,
    usernameEnabled: false,
    identifierFirst: false,
  },
  builtInProviders: {
    email: { enabled: false },
    phone: { enabled: false },
    web3Wallet: { enabled: false, chains: [1], allowSignUp: false },
    passkey: { allowSignUp: true },
    oneTap: {
      enabled: false,
      clientId: '',
      autoSelect: false,
      cancelOnTapOutside: true,
      uxMode: 'popup',
      context: 'signin',
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
    },
  },
  branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
  identityProviders: [],
  links: { termsUri: null, privacyUri: null, supportEmail: null },
  copy: { productName: 'Acme ID', headline: 'Sign in to Acme.', description: 'Hosted identity for Acme apps.' },
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
    issuer: 'https://auth.example.com/api/auth',
    discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
    authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
    tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
    jwksUri: 'https://auth.example.com/api/auth/jwks',
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
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

afterEach(() => {
  cleanup()
  signInWithPasskey.mockReset()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

describe('hosted passkey sign-in', () => {
  it('authenticates an enrolled passkey through the hosted sign-in card [spec: account-center/passkey-sign-in]', async () => {
    signInWithPasskey.mockResolvedValue({ redirect: false, token: 'session-token-1' })
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Passkey' }))

    await waitFor(() => expect(signInWithPasskey).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Signed in with passkey. Redirecting to the requested application.')).toBeTruthy()
  })

  it('surfaces hosted passkey sign-in failures', async () => {
    signInWithPasskey.mockRejectedValue(new Error('Passkey was not recognized.'))
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))

    render(<SignInPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Passkey' }))

    expect(await screen.findByText('Passkey was not recognized.')).toBeTruthy()
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
