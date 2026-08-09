import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExperiencePage } from '@/features/console/extracted/branding-content/branding'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
import { queryClient } from '@/router'
import {
  brandingSettings,
  consoleSharedFetch,
  jsonResponse,
  renderWithQuery,
  securityPolicy,
  signInSettings,
} from './console.test-utils'

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

describe('admin console sign-in and preview controls', () => {
  it('persists registration and hosted method availability [spec: admin-console/admin-sign-in-settings]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if ((url === '/api/realm/sign-in-policy' || url === '/api/realm/security-policy') && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(url.endsWith('policy') ? securityPolicy : signInSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const registration = (await screen.findByRole('heading', { name: 'Registration and identifiers' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(registration).getByRole('switch', { name: 'Public sign-up' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Username sign-in' }))
    fireEvent.change(screen.getByLabelText('Sign-in sequence'), { target: { value: 'identifier-first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests).toContainEqual({
      url: '/api/realm/sign-in-policy',
      body: expect.objectContaining({
        signIn: expect.objectContaining({
          signupEnabled: false,
          usernameEnabled: false,
          identifierFirst: true,
        }),
      }),
    })
  })

  it('discards unsaved method changes in the inline staged form', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleSharedFetch)
    renderWithQuery(<SignInSettingsPage />)
    const methods = (await screen.findByRole('heading', { name: 'Available sign-in methods' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(methods).getByRole('switch', { name: 'Password' }))
    expect(screen.getByRole('switch', { name: 'Password' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByRole('switch', { name: 'Password' }).getAttribute('aria-checked')).toBe('true')
  })

  it('surfaces sign-in management errors inside the editor', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/sign-in-policy' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Sign-in save failed.' } }, 500))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const methods = (await screen.findByRole('heading', { name: 'Available sign-in methods' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(methods).getByRole('switch', { name: 'Password' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Passkey' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Email code' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social login' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Phone' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Web3 wallet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Sign-in save failed.')).toBeTruthy()
  })

  it('renders runtime availability without legacy dead-end controls', async () => {
    const otpOnly = {
      ...signInSettings,
      signIn: {
        ...signInSettings.signIn,
        passwordEnabled: false,
        emailOtpEnabled: true,
        socialLoginEnabled: false,
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(otpOnly))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const preview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(within(preview).getByRole('button', { name: 'Continue with Email' })).toBeTruthy()
    expect(within(preview).queryByLabelText('Password')).toBeNull()
    expect(screen.queryByText('Email OTP')).toBeNull()
    expect(screen.queryByText('Forgot-password verification')).toBeNull()
    expect(screen.queryByLabelText('Terms URL')).toBeNull()
  })

  it('keeps the hosted preview focused without editor-only viewport or open-page controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/branding') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="theme" />)
    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Mobile' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Desktop' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open live hosted page' })).toBeNull()
  })
})
