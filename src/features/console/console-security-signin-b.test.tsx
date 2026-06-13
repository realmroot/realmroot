import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
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
  brandingSettings,
  consoleSharedFetch,
  jsonResponse,
  renderWithQuery,
  securityPolicy,
  signInSettings,
} from './console.test-utils'

describe('admin console security-signin-b', () => {
  it('renders sign-in validation errors without sending invalid public URLs', async () => {
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

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByLabelText('Terms URL')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save sign-in settings' })).toBeNull()
    expect(requests).toEqual([])
  })

  it('renders sign-in save errors from the management boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Sign-in save failed.' } }, 500))
      }
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(signInSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)

    fireEvent.click(await screen.findByRole('switch', { name: 'Passwordless' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save sign-in settings' }))

    expect(await screen.findByText('Sign-in save failed.')).toBeTruthy()
  })

  it('hides excluded sign-in method rows from runtime config', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') {
        return Promise.resolve(
          jsonResponse({
            ...signInSettings,
            signIn: {
              ...signInSettings.signIn,
              passwordEnabled: false,
              emailOtpEnabled: true,
              usernameEnabled: false,
            },
          }),
        )
      }
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)

    expect(await screen.findByRole('switch', { name: 'Passwordless' })).toBeTruthy()
    expect(screen.queryByText('Email OTP')).toBeNull()
    expect(screen.queryByText('Forgot-password verification')).toBeNull()
  })

  it('saves branding settings and applies custom CSS to the preview', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings' && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/northstar-logo.svg' },
    })
    expect(document.querySelector('img.brandLogo')?.getAttribute('width')).toBe('36')
    expect(document.querySelector('img.brandLogo')?.getAttribute('height')).toBe('36')
    expect(document.querySelector('img.assetPreview')?.getAttribute('width')).toBe('64')
    expect(document.querySelector('img.assetPreview')?.getAttribute('height')).toBe('64')
    fireEvent.change(screen.getByLabelText('Favicon URL'), {
      target: { value: 'https://cdn.example.com/northstar.ico' },
    })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#0f766e' } })
    fireEvent.change(screen.getByLabelText('Background color'), { target: { value: '#f8fafc' } })
    expect(screen.queryByRole('switch', { name: 'Dark mode' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: '--auth-panel-radius: 16px;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))

    expect(
      screen.getByLabelText('Northstar ID hosted sign-in preview').closest('.brandingPreview')?.getAttribute('style'),
    ).toContain('--auth-panel-radius: 16px')
    await waitFor(() =>
      expect(requests).toEqual([
        {
          url: '/api/management/branding-settings',
          body: {
            branding: {
              logoUrl: 'https://cdn.example.com/northstar-logo.svg',
              faviconUrl: 'https://cdn.example.com/northstar.ico',
              primaryColor: '#0f766e',
              backgroundColor: '#f8fafc',
              customCss: '--auth-panel-radius: 16px;',
            },
            copy: {
              productName: 'Northstar ID',
              headline: 'Sign in to Acme Auth',
              description: 'Continue with your Acme identity.',
            },
          },
        },
      ]),
    )
  })

  it('discards branding edits back to loaded branding values', async () => {
    const requests: string[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings' && init?.method === 'PATCH') {
        requests.push(url)
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    const logoUrl = (await screen.findByLabelText('Logo URL')) as HTMLInputElement
    fireEvent.change(logoUrl, { target: { value: 'https://cdn.example.com/changed.svg' } })
    fireEvent.change(screen.getByLabelText('Custom CSS'), { target: { value: 'display: none;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(logoUrl.value).toBe('https://cdn.example.com/logo.svg')
    expect(screen.getByLabelText('Custom CSS')).toHaveProperty('value', '--auth-panel-radius: 8px;')
    expect(requests).toEqual([])
  })

  it('renders polished branding upload controls', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    const logoInput = await screen.findByLabelText('Upload branding logo')
    const faviconInput = screen.getByLabelText('Upload favicon')
    expect(logoInput.className).toBe('assetUploadInput')
    expect(faviconInput.className).toBe('assetUploadInput')
    expect(screen.getAllByText('Choose file')).toHaveLength(2)
    expect(document.querySelectorAll('img.assetPreview')).toHaveLength(2)
  })

  it('switches the hosted sign-in preview between desktop and mobile viewports', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    const preview = (await screen.findByLabelText('Acme Auth hosted sign-in preview')).closest('.brandingPreview')
    expect(preview?.className).not.toContain('max-w-80')

    fireEvent.click(screen.getByRole('tab', { name: 'Mobile' }))

    expect(screen.getByRole('tab', { name: 'Mobile' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Acme Auth hosted sign-in preview').closest('.brandingPreview')?.className).toContain(
      'hostedAuthPreview-mobile',
    )
  })
})
