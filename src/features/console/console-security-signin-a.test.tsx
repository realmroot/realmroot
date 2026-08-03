import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MfaPage,
  SecurityBlocklistPage,
  SecurityCaptchaPage,
  SecurityPasswordPolicyPage,
} from '@/features/console/extracted/security-settings'
import { queryClient } from '@/router'
import { consoleSharedFetch, jsonResponse, renderWithQuery, securityPolicy } from './console.test-utils'

globalThis.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions({})
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

function securityFetch(requests: unknown[]) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/security/policy' && init?.method === 'PATCH') {
      requests.push(JSON.parse(String(init.body)))
      return Promise.resolve(jsonResponse(securityPolicy))
    }
    return consoleSharedFetch(input, init)
  }
}

describe('admin console security policies', () => {
  it('renders explicit disabled factors and configured abuse protections', async () => {
    const alternate = {
      policy: {
        ...securityPolicy.policy,
        mfa: {
          mode: 'optional' as const,
          authenticatorAppEnabled: false,
          emailOtpEnabled: true,
          backupCodesEnabled: false,
        },
        passkeys: { ...securityPolicy.policy.passkeys, enabled: false },
        captcha: {
          ...securityPolicy.policy.captcha,
          enabled: true,
          provider: 'hcaptcha' as const,
          siteKey: 'site-key-1',
          secretConfigured: true,
        },
        blocklist: { blockSubaddressing: true, entries: ['blocked.test'] },
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/security/policy') return Promise.resolve(jsonResponse(alternate))
      return consoleSharedFetch(input, init)
    })

    const mfa = renderWithQuery(<MfaPage />)
    expect(await screen.findByLabelText('Prompt policy')).toHaveProperty('value', 'optional')
    expect(screen.getByRole('switch', { name: 'Passkey' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Email verification code' }).getAttribute('aria-checked')).toBe('true')
    mfa.unmount()

    renderWithQuery(<SecurityCaptchaPage />)
    expect(await screen.findByLabelText('Provider')).toHaveProperty('value', 'hcaptcha')
    expect(screen.getByLabelText('Site key')).toHaveProperty('value', 'site-key-1')
    expect(screen.getByText('Configured')).toBeTruthy()
    expect(await screen.findByPlaceholderText('Leave blank to keep the current key')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  })

  it('shows available factors and persists the MFA prompt policy [spec: admin-console/admin-security-policy]', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    renderWithQuery(<MfaPage />)

    const factors = (await screen.findByRole('heading', { name: 'Available factors' })).closest(
      'section',
    ) as HTMLElement
    expect(within(factors).getByText('Passkey')).toBeTruthy()
    expect(within(factors).getByText('Authenticator app')).toBeTruthy()
    expect(within(factors).getByText('Email verification code')).toBeTruthy()
    expect(within(factors).getByText('Backup codes')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('Prompt policy'), { target: { value: 'optional' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Email verification code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          policy: {
            mfa: {
              mode: 'optional',
              authenticatorAppEnabled: true,
              emailOtpEnabled: true,
              backupCodesEnabled: true,
            },
            passkeys: { enabled: true },
          },
        },
      ]),
    )
  })

  it('edits password rules inline and persists the active tab atomically', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    renderWithQuery(<SecurityPasswordPolicyPage />)

    const section = (await screen.findByRole('heading', { name: 'Password policy' })).closest('section') as HTMLElement
    expect(within(section).getByLabelText('Minimum length')).toHaveProperty('value', '12')
    fireEvent.change(await screen.findByLabelText('Minimum length'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('Required character types'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Reject custom words' }))
    fireEvent.change(screen.getByLabelText('Custom words'), { target: { value: 'tenant\ninternal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          policy: expect.objectContaining({
            password: {
              minLength: 14,
              requiredCharacterTypes: 3,
              customWords: ['tenant', 'internal'],
              rejectUserInfo: true,
              rejectSequential: true,
              rejectCustomWords: true,
            },
          }),
        }),
      ]),
    )
  })

  it('discards controlled password and CAPTCHA values from inline forms [spec: admin-console/admin-security-policy]', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    const { unmount } = renderWithQuery(<SecurityPasswordPolicyPage />)

    await screen.findByRole('heading', { name: 'Password policy' })
    fireEvent.click(await screen.findByRole('switch', { name: 'Reject custom words' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect((await screen.findByRole('switch', { name: 'Reject custom words' })).getAttribute('aria-checked')).toBe(
      'false',
    )

    unmount()
    renderWithQuery(<SecurityCaptchaPage />)
    await screen.findByRole('heading', { name: 'CAPTCHA' })
    fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'hcaptcha' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(await screen.findByLabelText('Provider')).toHaveProperty('value', 'turnstile')
    expect(requests).toEqual([])
  })

  it('edits session lifetimes without exposing deployment environment variables', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    renderWithQuery(<SecurityPasswordPolicyPage />)

    await screen.findByRole('heading', { name: 'Session policy' })
    fireEvent.change(await screen.findByLabelText('Session lifetime'), { target: { value: '86400' } })
    fireEvent.change(screen.getByLabelText('Fresh authentication window'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          policy: expect.objectContaining({
            sessions: {
              expiresInSeconds: 86400,
              updateAgeSeconds: 300,
              freshAgeSeconds: 900,
              cookieCacheSeconds: 60,
            },
          }),
        }),
      ]),
    )
    expect(screen.queryByText(/environment variable/i)).toBeNull()
  })

  it('configures Turnstile with site and managed secret credentials', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    renderWithQuery(<SecurityCaptchaPage />)

    await screen.findByRole('heading', { name: 'CAPTCHA' })
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable CAPTCHA' }))
    expect(screen.getByLabelText('Provider')).toHaveProperty('value', 'turnstile')
    fireEvent.change(screen.getByLabelText('Site key'), { target: { value: 'site-key-1' } })
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'secret-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          policy: expect.objectContaining({
            captcha: {
              enabled: true,
              provider: 'turnstile',
              siteKey: 'site-key-1',
              projectId: null,
              secretKey: 'secret-1',
            },
          }),
        }),
      ]),
    )
  })

  it.each([
    { provider: 'hcaptcha' as const, secretLabel: 'Secret key', projectId: null },
    { provider: 'recaptcha-enterprise' as const, secretLabel: 'API key', projectId: 'project-1' },
  ])('persists $provider provider-specific credentials', async ({ projectId, provider, secretLabel }) => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    renderWithQuery(<SecurityCaptchaPage />)

    await screen.findByRole('heading', { name: 'CAPTCHA' })
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable CAPTCHA' }))
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: provider } })
    fireEvent.change(screen.getByLabelText('Site key'), { target: { value: 'site-key-1' } })
    if (projectId) fireEvent.change(screen.getByLabelText('Project ID'), { target: { value: projectId } })
    fireEvent.change(screen.getByLabelText(secretLabel), { target: { value: 'secret-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          policy: expect.objectContaining({
            captcha: {
              enabled: true,
              provider,
              siteKey: 'site-key-1',
              projectId,
              secretKey: 'secret-1',
            },
          }),
        }),
      ]),
    )
  })

  it('persists email blocklist entries and subaddressing policy', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation(securityFetch(requests))
    renderWithQuery(<SecurityBlocklistPage />)

    await screen.findByRole('heading', { name: 'Email blocklist' })
    fireEvent.click(await screen.findByRole('switch', { name: 'Block email subaddressing' }))
    fireEvent.change(screen.getByLabelText('Blocked addresses and domains'), {
      target: { value: 'blocked@example.com\nblocked.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        expect.objectContaining({
          policy: expect.objectContaining({
            blocklist: {
              blockSubaddressing: true,
              entries: ['blocked@example.com', 'blocked.test'],
            },
          }),
        }),
      ]),
    )
  })

  it('surfaces query and save errors and retries the security boundary', async () => {
    let reads = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/security/policy') {
        if (init?.method === 'PATCH') {
          return Promise.resolve(jsonResponse({ error: { message: 'Security save failed.' } }, 500))
        }
        reads += 1
        if (reads === 1) return Promise.resolve(jsonResponse({ error: { message: 'Security unavailable.' } }, 503))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SecurityCaptchaPage />)
    expect(await screen.findByText('Security unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: 'CAPTCHA' })
    fireEvent.change(await screen.findByLabelText('Site key'), { target: { value: 'site-key-1' } })
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Security save failed.')).toBeTruthy()
    expect(reads).toBeGreaterThanOrEqual(2)
  })
})
