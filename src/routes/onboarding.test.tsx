import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnboardingRoute } from './onboarding'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OnboardingRoute', () => {
  it('creates the first admin and removes password fields after success', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (url === '/api/onboarding/status') return Promise.resolve(jsonResponse({ required: true }))
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
      return Promise.resolve(
        jsonResponse(
          { user: { id: 'user-1', email: 'admin@example.com', role: 'admin' }, onboarding: { locked: true } },
          201,
        ),
      )
    })

    render(<OnboardingRoute />)

    fireEvent.change(await screen.findByLabelText('Name', { exact: true }), {
      target: { value: 'Admin User' },
    })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
    expect(screen.getByLabelText('Username').getAttribute('autocomplete')).toBe('username')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create first admin' }))

    await waitFor(() => {
      expect(requests).toEqual([
        {
          url: '/api/onboarding/admin-users',
          body: { email: 'admin@example.com', name: 'Admin User', password: 'password-1', username: 'admin' },
        },
      ])
    })
    expect(screen.getByText('First admin created. Sign in to finish Console setup.')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('shows first-admin creation errors without clearing the form', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = String(input)
      if (url === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (url === '/api/onboarding/status') return Promise.resolve(jsonResponse({ required: true }))
      return Promise.resolve(jsonResponse({ error: { message: 'First admin already exists.' } }, 409))
    })

    render(<OnboardingRoute />)

    fireEvent.change(await screen.findByLabelText('Name', { exact: true }), {
      target: { value: 'Admin User' },
    })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create first admin' }))

    expect(await screen.findByText('First admin already exists.')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function configz() {
  return {
    onboarding: { required: true, href: '/onboarding' },
    signIn: {
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: true,
      magicLinkEnabled: true,
      emailOtpEnabled: true,
      usernameEnabled: true,
      identifierFirst: false,
    },
    branding: { logoUrl: null, faviconUrl: null, primaryColor: null, backgroundColor: null, customCss: null },
    identityProviders: [],
    links: { termsUri: null, privacyUri: null, supportEmail: null },
    copy: { productName: 'Acme ID', headline: 'Sign in.', description: 'Hosted identity.' },
    defaults: { applicationId: null, redirectUri: null },
    auth: {},
    oidc: {},
    security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
  }
}
