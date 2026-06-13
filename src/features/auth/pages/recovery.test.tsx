import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthCallbackPage, ForgotPasswordPage } from '@/features/auth/pages/recovery'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
  branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
  identityProviders: [],
  links: { termsUri: null, privacyUri: null, supportEmail: null },
  copy: { productName: 'Acme ID', headline: 'Sign in.', description: 'Hosted identity.' },
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

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete window.turnstile
  window.history.pushState(null, '', '/')
})

describe('ForgotPasswordPage resend and reset', () => {
  it('starts a resend cooldown after sending the code and resets the password with the OTP', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)

    const email = await screen.findByLabelText('Email')
    fireEvent.change(email, { target: { value: 'jane@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    // The cooldown button starts at 60s and is disabled while counting down.
    const resend = await screen.findByText(/Resend code in 60s/)
    expect((resend as HTMLButtonElement).disabled).toBe(true)

    // The real 1s interval decrements the countdown.
    expect(await screen.findByText(/Resend code in 59s/, undefined, { timeout: 2000 })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('One-time code'), { target: { value: '123456' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/reset-password',
        body: { email: 'jane@example.com', otp: '123456', password: 'new-password-1' },
      }),
    )
  })

  it('re-enables the resend control after the cooldown elapses and re-requests the code', async () => {
    vi.useFakeTimers()
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@example.com' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/Resend code in 60s/)).toBeTruthy()

    // The countdown re-schedules a fresh 1s timeout on every tick, so advance one
    // second at a time to let each React state commit register the next timer.
    for (let i = 0; i < 60; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }

    const resend = screen.getByText('Resend code')
    expect((resend as HTMLButtonElement).disabled).toBe(false)

    await act(async () => {
      fireEvent.click(resend)
      await vi.advanceTimersByTimeAsync(0)
    })

    // Two password-reset requests: the initial send and the resend.
    expect(requests.filter((r) => r.url === '/api/auth/email-otp/request-password-reset')).toHaveLength(2)
  })

  it('includes the captcha token when captcha is enabled', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    window.turnstile = {
      render: vi.fn((_element, options) => {
        options.callback('captcha-token-1')
        return 'widget-1'
      }),
      remove: vi.fn(),
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') {
        return Promise.resolve(
          jsonResponse({ ...configz, captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key-1' } }),
        )
      }
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(jsonResponse({ success: true }))
    })

    render(<ForgotPasswordPage />)
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'jane@example.com' } })
    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/auth/email-otp/request-password-reset',
        body: { email: 'jane@example.com', captchaToken: 'captcha-token-1' },
      }),
    )
  })
})

describe('AuthCallbackPage consent handoff', () => {
  it('builds a consent link without a state parameter', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse(configz))
    window.history.pushState(
      null,
      '',
      '/auth/callback?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example.com%2Fcallback',
    )

    render(<AuthCallbackPage />)

    expect(await screen.findByRole('heading', { name: 'Consent is required before redirecting.' })).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Continue' }).getAttribute('href')!
    expect(link.startsWith('/oauth/consent?')).toBe(true)
    expect(link).not.toContain('state=')
  })
})
