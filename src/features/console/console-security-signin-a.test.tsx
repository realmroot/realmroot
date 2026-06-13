import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsPage } from '@/features/console/extracted/connectors'
import { DeploymentSettingsPage } from '@/features/console/extracted/deployment-misc/deployment'
import {
  MfaPage,
  SecurityBlocklistPage,
  SecurityCaptchaPage,
  SecurityGeneralPage,
  SecurityPasswordPolicyPage,
} from '@/features/console/extracted/security-settings'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
import { queryClient } from '@/router'

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

import {
  consoleSharedFetch,
  jsonResponse,
  pagination,
  readinessIncomplete,
  renderWithQuery,
  securityPolicy,
  signInSettings,
  webhookEndpoint,
  webhookRequest,
} from './console.test-utils'

describe('admin console security-signin-a', () => {
  it('renders editable MFA and password policy compact controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url.startsWith('/api/management/webhooks/endpoints')) {
        return Promise.resolve(jsonResponse({ endpoints: [webhookEndpoint], pagination }))
      }
      if (url.startsWith('/api/management/webhooks/requests')) {
        return Promise.resolve(jsonResponse({ requests: [webhookRequest], pagination }))
      }
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<MfaPage />)

    expect(await screen.findByText('Authenticator app')).toBeTruthy()
    expect(screen.queryByText('SMS verification code')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Email verification code' }))
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveProperty('disabled', false)

    unmount()
    renderWithQuery(<SecurityPasswordPolicyPage />)

    expect(await screen.findByLabelText('Minimum length')).toHaveProperty('value', '12')
    for (const name of [
      'Reject repetitive or sequential characters',
      'Reject user information',
      'Reject custom words',
    ]) {
      expect(screen.getByRole('switch', { name })).toHaveProperty('disabled', false)
    }
  })

  it('saves security policy changes through the management boundary', async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/management/security/policy' && method === 'PATCH') {
        const body = JSON.parse(String(init?.body))
        requests.push({ url, method, body })
        return Promise.resolve(
          jsonResponse({
            policy: {
              ...securityPolicy.policy,
              ...(body.policy as object),
            },
          }),
        )
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<MfaPage />)

    fireEvent.change(await screen.findByLabelText('Prompt policy'), { target: { value: 'optional' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/security/policy',
          method: 'PATCH',
          body: {
            policy: {
              mfa: {
                mode: 'optional',
                authenticatorAppEnabled: true,
                emailOtpEnabled: false,
                backupCodesEnabled: true,
              },
              passkeys: { enabled: true },
            },
          },
        },
      ]),
    )

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)

    fireEvent.change(await screen.findByLabelText('Minimum length'), { target: { value: '14' } })
    fireEvent.change(screen.getByLabelText('Required character types'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Reject custom words' }))
    fireEvent.change(screen.getByLabelText('Custom words'), { target: { value: 'tenant\ninternal' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in settings' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        method: 'PATCH',
        body: {
          policy: {
            passkeys: { enabled: true },
            password: {
              minLength: 14,
              requiredCharacterTypes: 3,
              customWords: ['tenant', 'internal'],
              rejectUserInfo: true,
              rejectSequential: true,
              rejectCustomWords: true,
            },
          },
        },
      }),
    )

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable CAPTCHA' }))
    fireEvent.change(screen.getByLabelText('Site key'), { target: { value: 'site-key-1' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'TURNSTILE_SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        method: 'PATCH',
        body: {
          policy: {
            captcha: {
              enabled: true,
              provider: 'turnstile',
              siteKey: 'site-key-1',
              secretBinding: 'TURNSTILE_SECRET',
            },
          },
        },
      }),
    )

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Block email subaddressing' }))
    fireEvent.change(screen.getByLabelText('Custom email and domain blocklist'), {
      target: { value: 'blocked@example.com\nblocked.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(requests).toContainEqual({
        url: '/api/management/security/policy',
        method: 'PATCH',
        body: {
          policy: {
            blocklist: {
              blockSubaddressing: true,
              entries: ['blocked@example.com', 'blocked.test'],
            },
          },
        },
      }),
    )
  })

  it('resets security policy form edits to persisted values', async () => {
    const policy = {
      policy: {
        ...securityPolicy.policy,
        mfa: { mode: 'optional' },
        passkeys: { ...securityPolicy.policy.passkeys, enabled: false },
        password: {
          minLength: 10,
          requiredCharacterTypes: 1,
          customWords: ['legacy'],
          rejectUserInfo: false,
          rejectSequential: false,
          rejectCustomWords: true,
        },
        captcha: {
          enabled: true,
          provider: 'turnstile',
          siteKey: 'persisted-site',
          secretBinding: 'PERSISTED_SECRET',
        },
        blocklist: {
          blockSubaddressing: true,
          entries: ['persisted.example'],
        },
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(policy))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<MfaPage />)
    expect(await screen.findByLabelText('Prompt policy')).toHaveProperty('value', 'optional')
    expect(screen.getByRole('switch', { name: 'Passkeys' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.change(screen.getByLabelText('Prompt policy'), { target: { value: 'required' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Prompt policy')).toHaveProperty('value', 'optional')

    unmount()
    renderWithQuery(<SecurityPasswordPolicyPage />)
    fireEvent.change(await screen.findByLabelText('Minimum length'), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText('Required character types'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Custom words'), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Reject repetitive or sequential characters' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Reject user information' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Reject custom words' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Minimum length')).toHaveProperty('value', '10')
    expect(screen.getByLabelText('Required character types')).toHaveProperty('value', '1')
    expect(screen.getByLabelText('Custom words')).toHaveProperty('value', 'legacy')
    expect(
      screen.getByRole('switch', { name: 'Reject repetitive or sequential characters' }).getAttribute('aria-checked'),
    ).toBe('false')
    expect(screen.getByRole('switch', { name: 'Reject user information' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('switch', { name: 'Reject custom words' }).getAttribute('aria-checked')).toBe('true')

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)
    expect(await screen.findByLabelText('Site key')).toHaveProperty('value', 'persisted-site')
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'turnstile' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable CAPTCHA' }))
    fireEvent.change(screen.getByLabelText('Site key'), { target: { value: 'changed-site' } })
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'CHANGED_SECRET' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Enable CAPTCHA' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Site key')).toHaveProperty('value', 'persisted-site')
    expect(screen.getByLabelText('Client secret')).toHaveProperty('value', 'PERSISTED_SECRET')

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Block email subaddressing' }))
    fireEvent.change(screen.getByLabelText('Custom email and domain blocklist'), {
      target: { value: 'changed.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Block email subaddressing' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('Custom email and domain blocklist')).toHaveProperty('value', 'persisted.example')

    cleanup()
    renderWithQuery(<SecurityGeneralPage />)
    expect(await screen.findByText('Enabled for hosted flows')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('10 characters')).toBeTruthy()
  })

  it('retries new security, connector, and OIDC surface load errors', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(jsonResponse({ error: 'Sign-in settings unavailable.' }, 503))
      }
      if (url === '/api/management/security/policy') {
        return Promise.resolve(jsonResponse({ error: 'Security policy unavailable.' }, 503))
      }
      if (url === '/api/management/readiness') return Promise.resolve(jsonResponse(readinessIncomplete))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<ConnectorsPage />)

    expect(await screen.findByText('Sign-in settings unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(requests.filter((url) => url === '/api/management/sign-in-settings').length).toBe(2))

    unmount()
    renderWithQuery(<SecurityGeneralPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const generalPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        generalPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<SecurityPasswordPolicyPage />)

    expect(await screen.findByText('Sign-in settings unavailable.')).toBeTruthy()
    const passwordPolicyRequests = requests.filter((url) => url === '/api/management/sign-in-settings').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/sign-in-settings').length).toBeGreaterThan(
        passwordPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<SecurityCaptchaPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const captchaPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        captchaPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<SecurityBlocklistPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const blocklistPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        blocklistPolicyRequests,
      ),
    )

    cleanup()
    renderWithQuery(<DeploymentSettingsPage />)

    expect(await screen.findByText('Security policy unavailable.')).toBeTruthy()
    const deploymentPolicyRequests = requests.filter((url) => url === '/api/management/security/policy').length
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(requests.filter((url) => url === '/api/management/security/policy').length).toBeGreaterThan(
        deploymentPolicyRequests,
      ),
    )
  })

  it('saves sign-in settings through the management boundary', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Passwordless' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow sign up' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social login' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save sign-in settings' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      url: '/api/management/sign-in-settings',
      body: {
        signIn: {
          passwordEnabled: false,
          signupEnabled: false,
          socialLoginEnabled: false,
        },
        builtInProviders: {
          phone: signInSettings.builtInProviders.phone,
          web3Wallet: signInSettings.builtInProviders.web3Wallet,
        },
      },
    })
  })

  it('discards sign-in settings edits back to loaded management values', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)

    const passwordSignIn = await screen.findByRole('switch', { name: 'Passwordless' })
    fireEvent.click(passwordSignIn)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(passwordSignIn.getAttribute('aria-checked')).toBe('false')
    expect(requests).toEqual([])
  })

  it('discards sign-in settings optional fields back to empty defaults', async () => {
    const settings = {
      ...signInSettings,
      links: { termsUri: null, privacyUri: null, supportEmail: null },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(settings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByLabelText('Default redirect URI')).toBeNull()
    expect(screen.queryByLabelText('Default application ID')).toBeNull()
    expect(screen.queryByLabelText('Terms URL')).toBeNull()
    expect(screen.queryByLabelText('Privacy URL')).toBeNull()
    expect(screen.queryByLabelText('Support email')).toBeNull()
  })
})
