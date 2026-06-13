import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInPage } from '@/features/auth/pages/sign-in'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const baseConfigz = {
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
      uxMode: 'popup' as const,
      context: 'signin' as const,
      promptBaseDelayMs: 1000,
      promptMaxAttempts: 5,
    },
  },
  branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
  identityProviders: [],
  links: { termsUri: null, privacyUri: null, supportEmail: null },
  copy: { productName: 'Acme ID', headline: 'Sign in to Acme.', description: 'Hosted identity.' },
  auth: {},
  oidc: {},
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

function config(overrides: Record<string, unknown> = {}) {
  return { ...baseConfigz, ...overrides }
}

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  assign = vi.fn()
  vi.stubGlobal('location', {
    ...window.location,
    assign,
    origin: 'https://auth.example.com',
    pathname: '/auth/sign-in',
    search: '',
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.ethereum
  delete window.google
  delete window.googleScriptInitialized
  window.history.pushState(null, '', '/')
})

describe('SignInPage extra branches', () => {
  it('redirects to the onboarding flow when onboarding is required', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(config({ onboarding: { required: true, href: '/onboarding' } })),
    )

    render(<SignInPage />)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/onboarding'))
  })

  it('completes a Web3 wallet sign-in and redirects after success', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse(
            config({
              builtInProviders: {
                ...baseConfigz.builtInProviders,
                web3Wallet: { enabled: true, chains: [1], allowSignUp: true },
              },
            }),
          ),
        )
      }
      requests.push(url)
      if (url.endsWith('/siwe/nonce')) return Promise.resolve(jsonResponse({ nonce: 'nonce123abc' }))
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('0x1')
        if (method === 'personal_sign') return Promise.resolve('0xsignature')
        return Promise.resolve(null)
      }),
    }

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Web3 wallet' }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/profile'))
    expect(requests.some((u) => u.endsWith('/siwe/verify'))).toBe(true)
  })

  it('redirects to sign-in help when wallet sign-in is forbidden', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse(
            config({
              builtInProviders: {
                ...baseConfigz.builtInProviders,
                web3Wallet: { enabled: true, chains: [1], allowSignUp: true },
              },
            }),
          ),
        )
      }
      if (url.endsWith('/siwe/nonce')) return Promise.resolve(jsonResponse({ nonce: 'nonce123abc' }))
      return Promise.resolve(jsonResponse({ error: 'No account.' }, 403))
    })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('0x1')
        if (method === 'personal_sign') return Promise.resolve('0xsignature')
        return Promise.resolve(null)
      }),
    }

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Web3 wallet' }))

    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('/auth/callback?error=missing_email_signup')),
    )
  })

  it('completes a Google One Tap sign-in and redirects after success', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse(
            config({
              builtInProviders: {
                ...baseConfigz.builtInProviders,
                oneTap: { ...baseConfigz.builtInProviders.oneTap, enabled: true, clientId: 'client-1' },
              },
            }),
          ),
        )
      }
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })
    window.googleScriptInitialized = true
    const initialize = vi.fn()
    window.google = {
      accounts: { id: { initialize, prompt: vi.fn() } },
    } as Window['google']

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with OneTap' }))

    await waitFor(() => expect(initialize).toHaveBeenCalled())
    await initialize.mock.calls[0][0].callback({ credential: 'id-token-1' })

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/profile'))
  })

  it('verifies a two-factor code after a password challenge', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(config()))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      if (url.endsWith('/sign-in/email')) return Promise.resolve(jsonResponse({ twoFactorRedirect: true }))
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })

    render(<SignInPage />)
    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const code = await screen.findByLabelText('Authenticator code')
    fireEvent.change(code, { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/auth/two-factor/verify-totp',
        body: { code: '654321', trustDevice: true },
      }),
    )
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/profile'))
  })

  it('signs in with a username when the identifier is not an email', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(config()))
      requests.push(url)
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })

    render(<SignInPage />)
    fireEvent.change(await screen.findByLabelText('Email or username'), { target: { value: 'jane' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(requests).toContain('/api/auth/sign-in/username'))
  })

  it('resends the email one-time code from the code-entry step', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz')
        return Promise.resolve(jsonResponse(config({ signIn: { ...baseConfigz.signIn, passwordEnabled: false } })))
      requests.push(url)
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })

    render(<SignInPage />)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '111111' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    await waitFor(() =>
      expect(requests.filter((u) => u === '/api/auth/email-otp/send-verification-otp').length).toBeGreaterThanOrEqual(
        2,
      ),
    )
  })

  it('resends the phone one-time code from the code-entry step', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse(
            config({
              builtInProviders: { ...baseConfigz.builtInProviders, phone: { enabled: true } },
            }),
          ),
        )
      }
      requests.push(url)
      return Promise.resolve(jsonResponse({ url: '/profile' }))
    })

    render(<SignInPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with Phone' }))
    fireEvent.change(await screen.findByLabelText('Phone'), { target: { value: '+15555550123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))

    await screen.findByLabelText('Verification code')
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }))

    await waitFor(() =>
      expect(requests.filter((u) => u === '/api/auth/phone-number/send-otp').length).toBeGreaterThanOrEqual(2),
    )
  })

  it('walks the identifier-first step before showing the password form', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(config({ signIn: { ...baseConfigz.signIn, identifierFirst: true } })),
    )

    render(<SignInPage />)

    const identifier = await screen.findByLabelText('Email or username')
    fireEvent.change(identifier, { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Signing in as')).toBeTruthy()
    expect(screen.getByText('jane@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeTruthy()
  })
})
