import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'
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
  connector,
  consoleSharedFetch,
  jsonResponse,
  pagination,
  renderWithQuery,
  securityPolicy,
  signInSettings,
} from './console.test-utils'

describe('admin console branding-content-a', () => {
  it('updates the hosted sign-in preview from unsaved branding edits [spec: admin-console/admin-branding-settings]', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/northstar-logo.svg' },
    })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#0f766e' } })
    fireEvent.change(screen.getByLabelText('Background color'), { target: { value: '#f8fafc' } })

    const preview = screen.getByLabelText('Northstar ID hosted sign-in preview').closest('.brandingPreview')
    expect(document.querySelector('.hostedAuthPanel .brandLogo')?.getAttribute('src')).toBe(
      'https://cdn.example.com/northstar-logo.svg',
    )
    expect(preview?.getAttribute('style')).toContain('--brand-primary: #0f766e')
    expect(preview?.getAttribute('style')).toContain('--brand-background: #f8fafc')
  })

  it('falls back to a brand mark when the hosted preview logo cannot load', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/missing-logo.svg' },
    })

    const logo = document.querySelector('.hostedAuthPanel img.brandLogo')
    expect(logo?.getAttribute('src')).toBe('https://cdn.example.com/missing-logo.svg')
    fireEvent.error(logo as Element)

    await waitFor(() => expect(document.querySelector('.hostedAuthPanel img.brandLogo')).toBeNull())
    expect(document.querySelector('.hostedAuthPanel .brandMark')?.textContent).toBe('N')
  })

  it('uses runtime sign-in method settings inside branding and content previews [spec: connectors-and-methods/hosted-preview-consistency]', async () => {
    const otpOnlySettings = {
      ...signInSettings,
      signIn: {
        ...signInSettings.signIn,
        passwordEnabled: false,
        emailOtpEnabled: true,
        socialLoginEnabled: false,
        signupEnabled: false,
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(otpOnlySettings))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<BrandingPage />)

    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with identity provider' })).toBeNull()
    expect(screen.queryByText('No account yet? Create account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()

    unmount()
    renderWithQuery(<ContentSettingsPage />)

    expect(await screen.findByLabelText('Acme Auth hosted sign-in preview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue with identity provider' })).toBeNull()
    expect(screen.queryByText('No account yet? Create account')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull()
  })

  it('renders hosted sign-in previews inside editable sign-in experience pages', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const previewSignInSettings = {
      ...signInSettings,
      signIn: { ...signInSettings.signIn, emailOtpEnabled: true },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(previewSignInSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      if (url === '/api/management/connectors')
        return Promise.resolve(jsonResponse({ connectors: [connector], pagination }))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<SignInSettingsPage />)

    const signInPreview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(signInPreview).toBeTruthy()
    expect(signInPreview.closest('.brandingPreview')?.getAttribute('style')).toContain('--auth-panel-radius: 8px')
    expect(signInPreview.closest('.brandingPreview')?.getAttribute('style')).toContain('--brand-primary: #2563eb')
    expect(signInPreview.querySelector('img.brandLogo')?.getAttribute('src')).toBe('https://cdn.example.com/logo.svg')
    expect(screen.queryByRole('link', { name: 'Desktop' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Mobile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    expect(screen.queryByText('Choose how to continue')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue with Email' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue with Phone' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeTruthy()
    expect(signInPreview.querySelector('button img[src="https://cdn.simpleicons.org/google"]')).toBeTruthy()
    expect(signInPreview.querySelector('.authMethodDivider')?.textContent).toBe('or')
    expect(signInPreview.querySelector('.authSignupPrompt')?.textContent).toBe('No account yet? Create account')
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Continue with Email' }))
    expect(within(signInPreview).getByRole('button', { name: /Send (code|sign-in link)/ })).toBeTruthy()
    expect(within(signInPreview).getByRole('button', { name: 'Back to sign in' })).toBeTruthy()
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Back to sign in' }))
    const previewPathBeforeSignup = window.location.pathname
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Create account' }))
    expect(window.location.pathname).toBe(previewPathBeforeSignup)
    expect(within(signInPreview).getByRole('heading', { name: 'Create account' })).toBeTruthy()
    expect(within(signInPreview).getByLabelText('Name')).toBeTruthy()
    expect(within(signInPreview).getByLabelText('Username')).toBeTruthy()
    fireEvent.click(within(signInPreview).getByRole('button', { name: 'Already have an account?' }))
    expect(screen.queryByLabelText('Headline')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Passwordless' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social login' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Allow sign up' }))
    expect(screen.queryByRole('button', { name: 'Password' })).toBeNull()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
    expect(screen.queryByText('Choose how to continue')).toBeNull()
    expect(screen.queryByText('No account yet? Create account')).toBeNull()
    const desktopPreviewButton = screen.getByRole('button', { name: 'Open hosted sign-in' })
    fireEvent.click(desktopPreviewButton)
    expect(open).toHaveBeenCalledWith('/auth/sign-in', '_blank', 'noopener')

    unmount()
    renderWithQuery(<ContentSettingsPage />)

    const contentPreview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(contentPreview).toBeTruthy()
    expect(contentPreview.closest('.brandingPreview')?.getAttribute('style')).toContain('--auth-panel-radius: 8px')
    expect(contentPreview.querySelector('img.brandLogo')?.getAttribute('src')).toBe('https://cdn.example.com/logo.svg')
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://example.com/terms')
    fireEvent.change(screen.getByLabelText('Sign-in message'), { target: { value: 'Content preview changed' } })
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Northstar Content' } })
    fireEvent.change(screen.getByLabelText('Terms URL'), {
      target: { value: 'https://northstar.example.com/terms' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'content@northstar.example' } })
    expect(screen.getByRole('heading', { name: 'Content preview changed' })).toBeTruthy()
    expect(screen.getByLabelText('Northstar Content hosted sign-in preview')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://northstar.example.com/terms')
    expect(screen.getByRole('link', { name: 'Support' }).getAttribute('href')).toBe('mailto:content@northstar.example')
  })

  it('renders OneTap in hosted previews from the same sign-in method controls', async () => {
    const oneTapSettings = {
      ...signInSettings,
      signIn: { ...signInSettings.signIn, passwordEnabled: false, emailOtpEnabled: false, socialLoginEnabled: false },
      builtInProviders: {
        ...signInSettings.builtInProviders,
        oneTap: { ...signInSettings.builtInProviders.oneTap, enabled: true, clientId: 'google-client-id' },
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/sign-in-settings') return Promise.resolve(jsonResponse(oneTapSettings))
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      if (url === '/api/management/connectors') return Promise.resolve(jsonResponse({ connectors: [], pagination }))
      if (url === '/api/management/security/policy') return Promise.resolve(jsonResponse(securityPolicy))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ContentSettingsPage />)

    const signInPreview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(within(signInPreview).getByRole('button', { name: 'Continue with OneTap' })).toBeTruthy()
    expect(within(signInPreview).queryByText('No sign-in methods are enabled.')).toBeNull()
  })

  it('does not apply unsafe custom CSS to the branding preview', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Custom CSS'), { target: { value: 'display: none;' } })

    expect(
      screen.getByLabelText('Acme Auth hosted sign-in preview').closest('.brandingPreview')?.getAttribute('style'),
    ).not.toContain('display')
  })

  it('renders branding validation errors without sending invalid custom CSS', async () => {
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

    fireEvent.change(await screen.findByLabelText('Custom CSS'), { target: { value: 'display: none;' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }))

    expect(
      await screen.findByText('Custom CSS only supports declaration-only --auth-* custom properties.'),
    ).toBeTruthy()
    expect(requests).toEqual([])
  })

  it('renders branding save and upload errors from the management boundary', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/management/branding-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Branding save failed.' } }, 500))
      }
      if (url === '/api/management/branding/logo' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Logo upload failed.' } }, 500))
      }
      if (url === '/api/management/branding/favicon' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Favicon upload failed.' } }, 500))
      }
      if (url === '/api/management/branding-settings') return Promise.resolve(jsonResponse(brandingSettings))
      return consoleSharedFetch(input, init)
    })

    const { unmount } = renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Changed Auth' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Save branding' }))
    expect(await screen.findByText('Branding save failed.')).toBeTruthy()

    unmount()
    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Upload branding logo'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Logo upload failed.')).toBeTruthy()

    cleanup()
    renderWithQuery(<BrandingPage />)

    fireEvent.change(await screen.findByLabelText('Upload favicon'), {
      target: { files: [new File(['icon'], 'favicon.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Favicon upload failed.')).toBeTruthy()
  })
})
