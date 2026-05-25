import { describe, expect, it } from 'vitest'
import { createApp } from '../app'

describe('configz routes', () => {
  it('serves public runtime config and does not expose removed hosted API contracts', async () => {
    const app = createApp(createAuthMock(), {
      configzServiceFactory: () => ({
        getConfig: async () => ({
          onboarding: { required: true, href: '/onboarding' },
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
            web3Wallet: { enabled: false, chains: [1], allowSignUp: true },
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
            endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/end-session',
          },
          security: {
            mfaRequired: false,
            sessionExpiresInSeconds: 0,
            passkeysEnabled: false,
          },
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
          captcha: {
            enabled: false,
            provider: 'turnstile',
            siteKey: '',
          },
        }),
      }),
    })

    const response = await app.request('/api/configz')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      onboarding: { required: true, href: '/onboarding' },
      auth: { signInEmailPath: '/api/auth/sign-in/email' },
    })

    expect((await app.request('/api/experience')).status).toBe(404)
    expect((await app.request('/api/setup')).status).toBe(404)
  })
})

function createAuthMock() {
  return {
    handler: async () => new Response(null, { status: 204 }),
    api: {
      getSession: async () => null,
      getOAuthServerConfig: async () => ({}),
      getOpenIdConfig: async () => ({}),
    },
  }
}
