import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authContinuationParams,
  authPageHref,
  authRequestContext,
  primarySignInMode,
  readRedirectUrl,
  redirectDestination,
  requiresTwoFactor,
  safeAuthRedirect,
} from '@/features/auth/pages/controls'
import { SignInPage } from '@/features/auth/pages/sign-in'

const configz = {
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
    primaryColor: '#b42318',
    backgroundColor: '#f7f3ee',
    customCss: null,
  },
  identityProviders: [
    {
      slug: 'github',
      providerType: 'social',
      providerId: 'github',
      displayName: 'GitHub',
      icon: 'github',
    },
    {
      slug: 'demo-sso',
      providerType: 'generic_oauth',
      providerId: 'demo-sso',
      displayName: 'Example SSO',
      icon: 'oauth',
    },
  ],
  links: {
    termsUri: null,
    privacyUri: null,
    supportEmail: null,
  },
  copy: {
    productName: 'Acme ID',
    headline: 'Sign in to Acme.',
    description: 'Hosted identity for Acme apps.',
  },
  auth: authPaths(),
  oidc: oidcMetadata(),
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

const _consentResponse = {
  application: {
    id: 'app-1',
    slug: 'client',
    name: 'Client App',
    description: 'Reads profile data.',
    homepageUrl: 'https://client.example.com',
    iconUrl: null,
    clientId: 'client-1',
    clientType: 'public_spa',
    public: true,
    firstParty: false,
    trusted: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['https://client.example.com/callback'],
    allowedGrantTypes: ['authorization_code'],
    allowedScopes: ['openid', 'profile', 'email'],
    requirePkce: true,
    tokenEndpointAuthMethod: 'none',
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/logout',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  user: {
    email: 'jane@example.com',
    displayName: 'Jane Stone',
    image: null,
  },
  redirects: {
    approveUrl:
      '/api/auth/oauth2/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    denyUrl: 'https://client.example.com/callback?error=access_denied&state=state-1',
  },
  requestedScopes: ['openid', 'profile'],
  existingConsent: null,
  state: 'state-1',
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.turnstile
  delete window.ethereum
  window.history.pushState(null, '', '/')
})

describe('hosted auth pages 1', () => {
  it('normalizes hosted auth continuation and redirect helpers', () => {
    expect(primarySignInMode({ ...configz.signIn, passwordEnabled: true, emailOtpEnabled: true })).toBe('password')
    expect(primarySignInMode({ ...configz.signIn, passwordEnabled: false, emailOtpEnabled: true })).toBe('otp')
    expect(primarySignInMode({ ...configz.signIn, passwordEnabled: false, emailOtpEnabled: false })).toBeNull()
    expect(redirectDestination('https://client.example.com/callback')).toBe('client.example.com')
    expect(redirectDestination('not-a-url')).toBeNull()
    expect(requiresTwoFactor({ twoFactorRedirect: true })).toBe(true)
    expect(requiresTwoFactor({ twoFactorRedirect: false })).toBe(false)
    expect(readRedirectUrl(null)).toBeNull()
    expect(readRedirectUrl({ url: '/profile' })).toBe('/profile')
    expect(readRedirectUrl({ redirectTo: '/settings' })).toBe('/settings')
    expect(readRedirectUrl({ callbackURL: '/callback' })).toBe('/callback')
    expect(readRedirectUrl({ url: 'https://client.example.com/callback' })).toBeNull()
    expect(readRedirectUrl({ url: 'https://client.example.com/callback' }, { allowExternal: true })).toBe(
      'https://client.example.com/callback',
    )
    expect(safeAuthRedirect('/profile')).toBe('/profile')
    expect(safeAuthRedirect('https://client.example.com/callback')).toBeNull()

    window.history.pushState(
      null,
      '',
      '/auth/sign-in?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1&token=ignored',
    )
    expect(authContinuationParams().toString()).toBe(
      'client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    expect(authPageHref('/auth/sign-up')).toBe(
      '/auth/sign-up?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback&state=state-1',
    )
    expect(authRequestContext('sign-in')).toEqual({
      title: 'Continue to client.example.com.',
      description: 'Sign in with your hosted account to continue to client.example.com.',
    })
    expect(authRequestContext('sign-up')).toEqual({
      title: 'Create an account for client.example.com.',
      description: 'Create a hosted account to continue to client.example.com.',
    })
    expect(authRequestContext('recovery')).toEqual({
      title: 'Recover access for client.example.com.',
      description: 'Recover your hosted account before continuing to client.example.com.',
    })
    expect(authRequestContext('verification')).toEqual({
      title: 'Verify your email for client.example.com.',
      description: 'Confirm your email address before continuing to client.example.com.',
    })

    window.history.pushState(null, '', '/auth/sign-in?client_id=client-1&redirect_uri=bad')
    expect(authRequestContext('sign-in')).toEqual({
      title: 'Continue to the requested application.',
      description: 'Sign in with your hosted account to continue.',
    })
    window.history.pushState(null, '', '/auth/sign-in')
    expect(authContinuationParams().toString()).toBe('')
    expect(authPageHref('/auth/sign-up')).toBe('/auth/sign-up')
    expect(authRequestContext('sign-in')).toEqual({})
  })

  it('renders a product-focused sign-in form and social connectors from configz [spec: hosted-auth/public-sign-in]', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))
    const user = userEvent.setup()

    render(<SignInPage />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(screen.getByRole('main', { name: 'Hosted authentication' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Sign in to Acme.' })).toBeTruthy()
    expect(document.querySelector('.authPanel')).toBeTruthy()
    expect(document.querySelector('.authBrandPanel .brandMark')?.textContent).toBe('A')
    expect(document.querySelector('.segmented')).toBeNull()
    expect(screen.queryByText('Choose how to continue')).toBeNull()
    expect(screen.queryByText('Choose an enabled method to access this application.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toContain('uiButton-primary')
    expect(screen.getByRole('link', { name: 'Forgot password?' }).closest('form')).toBe(
      screen.getByRole('button', { name: 'Sign in' }).closest('form'),
    )
    expect(document.querySelector('.authSignupPrompt')?.textContent).toBe('No account yet? Create account')
    expect(screen.getByRole('button', { name: 'Continue with Email' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue with Phone' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with Example SSO' })).toBeTruthy()
    expect(document.querySelector('.authMethodDivider')?.textContent).toBe('or')
    await user.click(screen.getByRole('button', { name: 'Continue with Email' }))
    expect(await screen.findByRole('button', { name: 'Send code' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.getByText('Powered by Acme ID')).toBeTruthy()
    expect(screen.queryByText('Authenticator verification')).toBeNull()
  })

  it('submits Turnstile CAPTCHA tokens with hosted auth initiation requests', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    let rendered = 0
    type CaptchaCallbacks = {
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    }
    const callbackRef: { current?: CaptchaCallbacks } = {}
    window.turnstile = {
      render: vi.fn((_element, options) => {
        rendered += 1
        callbackRef.current = options
        options.callback(`captcha-token-${rendered}`)
        return `widget-${rendered}`
      }),
      remove: vi.fn(),
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key-1' },
          }),
        )
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ error: 'Invalid credentials.' }, 401))
    })

    const { unmount } = render(<SignInPage />)

    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled())
    const captchaCallbacks = callbackRef.current
    if (!captchaCallbacks) throw new Error('Turnstile callbacks were not registered.')
    captchaCallbacks['expired-callback']()
    captchaCallbacks['error-callback']()
    captchaCallbacks.callback('captcha-token-restored')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/sign-in/email',
        body: {
          email: 'jane@example.com',
          password: 'password-1',
          rememberMe: true,
          captchaToken: 'captcha-token-1',
        },
      })
    })

    await waitFor(() => expect(window.turnstile?.remove).toHaveBeenCalledWith('widget-1'))
    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalledTimes(2))
    unmount()
  })

  it('loads the Turnstile script before rendering the CAPTCHA widget', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({
            ...configz,
            captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key-1' },
          }),
        )
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<SignInPage />)

    await waitFor(() => expect(document.querySelector('script[data-turnstile-script="true"]')).toBeTruthy())
    const script = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]')!
    window.turnstile = {
      render: vi.fn((_element, options) => {
        options.callback('captcha-token-1')
        return 'widget-1'
      }),
      remove: vi.fn(),
    }
    script.dispatchEvent(new Event('load'))

    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled())
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        url: '/api/auth/sign-in/email',
        body: expect.objectContaining({ captchaToken: 'captcha-token-1' }),
      })
    })
  })

  it('renders social connector icon variants from configz metadata', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse({
        ...configz,
        identityProviders: [
          { slug: 'github', providerType: 'social', providerId: 'github', displayName: 'GitHub', icon: 'github' },
          { slug: 'google', providerType: 'social', providerId: 'google', displayName: 'Google', icon: 'google' },
          {
            slug: 'microsoft',
            providerType: 'social',
            providerId: 'microsoft',
            displayName: 'Microsoft',
            icon: 'microsoft',
          },
          { slug: 'gitlab', providerType: 'social', providerId: 'gitlab', displayName: 'GitLab', icon: 'gitlab' },
          {
            slug: 'facebook',
            providerType: 'social',
            providerId: 'facebook',
            displayName: 'Facebook',
            icon: 'facebook',
          },
          { slug: 'apple', providerType: 'social', providerId: 'apple', displayName: 'Apple', icon: 'apple' },
          { slug: 'custom', providerType: 'social', providerId: 'custom', displayName: 'Custom', icon: 'oauth' },
        ],
      }),
    )

    render(<SignInPage />)

    for (const provider of ['GitHub', 'Google', 'Microsoft', 'GitLab', 'Facebook', 'Apple', 'Custom']) {
      expect(await screen.findByRole('button', { name: `Continue with ${provider}` })).toBeTruthy()
    }
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authPaths() {
  return {
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
  }
}

function oidcMetadata() {
  return {
    issuer: 'https://auth.example.com/api/auth',
    discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
    authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
    tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
    jwksUri: 'https://auth.example.com/api/auth/jwks',
    userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
    endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
  }
}
