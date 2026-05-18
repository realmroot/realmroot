import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountCenterPage } from './account-center'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('account center', () => {
  it('loads profile, security, session, connection, and application sections', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const path = String(input)
      if (path === '/api/experience') return Promise.resolve(jsonResponse(experienceConfig()))
      if (path === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile() }))
      if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
      if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
      if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
      if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security: security() }))
      if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
      return Promise.resolve(jsonResponse({}))
    })

    render(<AccountCenterPage />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Linked accounts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sessions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Consented apps' })).toBeTruthy()

    await waitFor(() => expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Jane Stone'))
  })
})

function experienceConfig() {
  return {
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
