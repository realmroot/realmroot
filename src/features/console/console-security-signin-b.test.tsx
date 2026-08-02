import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
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
      if ((url === '/api/sign-in-settings' || url === '/api/security/policy') && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(url.endsWith('policy') ? securityPolicy : signInSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const registration = (await screen.findByRole('heading', { name: 'Registration and identifiers' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(registration).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Public sign-up' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Username sign-in' }))
    fireEvent.change(screen.getByLabelText('Sign-in sequence'), { target: { value: 'identifier-first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests).toContainEqual({
      url: '/api/sign-in-settings',
      body: expect.objectContaining({
        signIn: expect.objectContaining({
          signupEnabled: false,
          usernameEnabled: false,
          identifierFirst: true,
        }),
      }),
    })
  })

  it('cancels unsaved method changes and keeps the persisted summary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleSharedFetch)
    renderWithQuery(<SignInSettingsPage />)
    const methods = (await screen.findByRole('heading', { name: 'Available sign-in methods' })).closest(
      'section',
    ) as HTMLElement
    expect(within(methods).getAllByText('Enabled').length).toBeGreaterThan(0)
    fireEvent.click(within(methods).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Password' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Available sign-in methods', hidden: true })).toBeTruthy(),
    )
    expect(within(methods).getAllByText('Enabled').length).toBeGreaterThan(0)
    fireEvent.click(within(methods).getByRole('button', { name: 'Edit' }))
    expect((await screen.findByRole('switch', { name: 'Password' })).getAttribute('aria-checked')).toBe('true')
  })

  it('surfaces sign-in management errors inside the editor', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/sign-in-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Sign-in save failed.' } }, 500))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const methods = (await screen.findByRole('heading', { name: 'Available sign-in methods' })).closest(
      'section',
    ) as HTMLElement
    fireEvent.click(within(methods).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Password' }))
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
      if (String(input) === '/api/sign-in-settings') return Promise.resolve(jsonResponse(otpOnly))
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

  it('switches the hosted preview between desktop and mobile viewports', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)
    const preview = (await screen.findByLabelText('Acme Auth hosted sign-in preview')).closest('.brandingPreview')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Mobile' }), { button: 0, ctrlKey: false })
    expect(screen.getByRole('tab', { name: 'Mobile' }).getAttribute('aria-selected')).toBe('true')
    expect(preview?.className).toContain('hostedAuthPreview-mobile')
  })
})
