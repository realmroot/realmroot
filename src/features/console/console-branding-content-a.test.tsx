import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandingPage } from '@/features/console/extracted/branding-content/branding'
import { ContentSettingsPage } from '@/features/console/extracted/branding-content/content-settings'
import { SignInSettingsPage } from '@/features/console/extracted/sign-in-settings'
import { queryClient } from '@/router'
import {
  brandingSettings,
  consoleSharedFetch,
  jsonResponse,
  pagination,
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

describe('admin console hosted experience', () => {
  it('updates the live preview and persists a tested color scheme [spec: admin-console/admin-branding-settings]', async () => {
    const patches: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/branding-settings' && init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    const preview = (await screen.findByLabelText('Acme Auth hosted sign-in preview')).closest('.brandingPreview')
    fireEvent.click(screen.getByRole('button', { name: /Fresh Matcha/ }))
    expect(preview?.getAttribute('style')).toContain('--brand-primary: #668a6a')
    expect(preview?.getAttribute('style')).toContain('--brand-background: #fafcf8')
    expect(preview?.getAttribute('style')).toContain('--auth-text-color: #1c2a20')
    expect(preview?.getAttribute('style')).toContain('--auth-border-color: #dce6d8')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({
      branding: {
        primaryColor: '#668a6a',
        backgroundColor: '#fafcf8',
        customCss: '--auth-text-color: #1c2a20; --auth-border-color: #dce6d8',
      },
      copy: { productName: 'Acme Auth' },
    })
  })

  it('supports a four-color custom scheme and restores all saved theme colors', async () => {
    const customBranding = {
      ...brandingSettings,
      branding: {
        ...brandingSettings.branding,
        primaryColor: '#135f5a',
        backgroundColor: '#fbfefd',
        customCss: '--auth-text-color: #18302d; --auth-border-color: #bdd7d2',
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/branding-settings') return Promise.resolve(jsonResponse(customBranding))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    expect(await screen.findByLabelText('Primary')).toHaveProperty('value', '#135f5a')
    expect(screen.getByLabelText('Page background')).toHaveProperty('value', '#fbfefd')
    expect(screen.getByLabelText('Text')).toHaveProperty('value', '#18302d')
    expect(screen.getByLabelText('Border')).toHaveProperty('value', '#bdd7d2')

    fireEvent.click(screen.getByRole('button', { name: /Clean Cobalt/ }))
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    fireEvent.change(screen.getByLabelText('Primary color picker'), { target: { value: '#12524e' } })
    fireEvent.change(screen.getByLabelText('Page background'), { target: { value: '#f5fbf9' } })
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: '#102724' } })
    fireEvent.change(screen.getByLabelText('Border'), { target: { value: '#aacbc5' } })
    expect(
      screen.getByLabelText('Acme Auth hosted sign-in preview').closest('.brandingPreview')?.getAttribute('style'),
    ).toContain('--brand-primary: #12524e')
    expect(
      screen.getByLabelText('Acme Auth hosted sign-in preview').closest('.brandingPreview')?.getAttribute('style'),
    ).toContain('--auth-text-color: #102724')
  })

  it('uses the tested default scheme when optional brand and link values are unset', async () => {
    const defaultBranding = {
      ...brandingSettings,
      branding: {
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        backgroundColor: null,
        customCss: null,
      },
    }
    const defaultSignIn = {
      ...signInSettings,
      links: { termsUri: null, privacyUri: null, supportEmail: null },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/branding-settings') return Promise.resolve(jsonResponse(defaultBranding))
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(defaultSignIn))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)

    expect((await screen.findByRole('button', { name: /Clear Aqua/ })).getAttribute('aria-pressed')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Brand assets' }), { button: 0, ctrlKey: false })
    expect(await screen.findByLabelText('Logo URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', '')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Legal & support' }), { button: 0, ctrlKey: false })
    expect(await screen.findByLabelText('Terms URL')).toHaveProperty('value', '')
  })

  it('uploads and previews both hosted brand assets', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/branding/logo' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ asset: { id: 'logo-2', publicUrl: 'https://cdn.example.com/logo.svg' } }))
      }
      if (url === '/api/branding/favicon' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ asset: { id: 'favicon-2', publicUrl: 'https://cdn.example.com/favicon.png' } }),
        )
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Brand assets' }), { button: 0, ctrlKey: false })
    fireEvent.change(await screen.findByLabelText('Favicon URL'), {
      target: { value: 'https://cdn.example.com/manual-favicon.png' },
    })
    fireEvent.change(screen.getByLabelText('Upload logo'), {
      target: { files: [new File(['logo'], 'logo.svg', { type: 'image/svg+xml' })] },
    })
    fireEvent.change(screen.getByLabelText('Upload favicon'), {
      target: { files: [new File(['favicon'], 'favicon.png', { type: 'image/png' })] },
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Logo URL')).toHaveProperty('value', 'https://cdn.example.com/logo.svg'),
    )
    await waitFor(() =>
      expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', 'https://cdn.example.com/favicon.png'),
    )
  })

  it('retries all hosted experience dependencies after a load failure', async () => {
    let attempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/branding-settings') {
        attempts += 1
        return attempts === 1
          ? Promise.resolve(jsonResponse({ error: { message: 'Experience unavailable.' } }, 503))
          : Promise.resolve(jsonResponse(brandingSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Color scheme' })).toBeTruthy()
    expect(attempts).toBe(2)
  })

  it('updates brand assets in the preview, falls back cleanly, and surfaces upload errors', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/branding/logo' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ error: { message: 'Logo upload failed.' } }, 500))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<BrandingPage />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Brand assets' }), { button: 0, ctrlKey: false })
    fireEvent.change(await screen.findByLabelText('Product name'), { target: { value: 'Northstar ID' } })
    fireEvent.change(screen.getByLabelText('Logo URL'), {
      target: { value: 'https://cdn.example.com/northstar.svg' },
    })

    const preview = screen.getByLabelText('Northstar ID hosted sign-in preview')
    const logo = preview.querySelector('img.brandLogo')
    expect(logo?.getAttribute('src')).toBe('https://cdn.example.com/northstar.svg')
    fireEvent.error(logo as Element)
    await waitFor(() => expect(preview.querySelector('img.brandLogo')).toBeNull())
    expect(preview.querySelector('.brandMark')?.textContent).toBe('N')

    fireEvent.change(screen.getByLabelText('Upload logo'), {
      target: { files: [new File(['logo'], 'logo.png', { type: 'image/png' })] },
    })
    expect(await screen.findByText('Logo upload failed.')).toBeTruthy()
  })

  it('keeps the preview consistent with unsaved sign-in method controls [spec: connectors-and-methods/hosted-preview-consistency]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if ((url === '/api/sign-in-settings' || url === '/api/security/policy') && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(url.endsWith('policy') ? securityPolicy : signInSettings))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: { ...pagination, total: 0 } }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const preview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    const methods = screen.getByRole('heading', { name: 'Available sign-in methods' }).closest('section') as HTMLElement
    fireEvent.click(within(methods).getByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Password' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Email code' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Social login' }))

    expect(within(preview).getByRole('button', { name: 'Continue with Email' })).toBeTruthy()
    expect(within(preview).queryByLabelText('Password')).toBeNull()
    expect(within(preview).queryByRole('button', { name: 'Continue with Google' })).toBeNull()
    fireEvent.click(within(preview).getByRole('button', { name: 'Continue with Email' }))
    expect(within(preview).getByRole('button', { name: 'Send code' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests).toContainEqual({
      url: '/api/sign-in-settings',
      body: expect.objectContaining({
        signIn: expect.objectContaining({ passwordEnabled: false, emailOtpEnabled: true, socialLoginEnabled: false }),
      }),
    })
  })

  it('persists legal and support destinations without exposing custom copy controls [spec: admin-console/admin-content-settings]', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/sign-in-settings' && init?.method === 'PATCH') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/branding-settings' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ContentSettingsPage />)
    expect(await screen.findByLabelText('Terms URL')).toBeTruthy()
    expect(screen.queryByLabelText('Sign-in message')).toBeNull()
    expect(screen.queryByLabelText('Sign-up message')).toBeNull()
    fireEvent.change(screen.getByLabelText('Terms URL'), {
      target: { value: 'https://northstar.example.com/terms' },
    })
    fireEvent.change(screen.getByLabelText('Privacy URL'), {
      target: { value: 'https://northstar.example.com/privacy' },
    })
    fireEvent.change(screen.getByLabelText('Support email'), {
      target: { value: 'support@northstar.example' },
    })

    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://northstar.example.com/terms')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toEqual([
        {
          links: {
            termsUri: 'https://northstar.example.com/terms',
            privacyUri: 'https://northstar.example.com/privacy',
            supportEmail: 'support@northstar.example',
          },
        },
      ]),
    )
  })

  it('renders configured One Tap as a usable hosted method', async () => {
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
      if (url === '/api/sign-in-settings') return Promise.resolve(jsonResponse(oneTapSettings))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ connectors: [], pagination: { ...pagination, total: 0 } }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ContentSettingsPage />)
    const preview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(within(preview).getByRole('button', { name: 'Continue with OneTap' })).toBeTruthy()
    expect(within(preview).queryByText('No sign-in methods are enabled.')).toBeNull()
  })
})
