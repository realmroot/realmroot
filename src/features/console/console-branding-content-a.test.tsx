import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExperiencePage } from '@/features/console/extracted/branding-content/branding'
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
      if (url === '/api/realm/branding' && init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="theme" />)

    const preview = (await screen.findByLabelText('Acme Auth hosted sign-in preview')).closest('.brandingPreview')
    const save = screen.getByRole('button', { name: 'Save changes' })
    const discard = screen.getByRole('button', { name: 'Discard' })
    expect(save).toHaveProperty('disabled', true)
    expect(discard).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: /Sage/ }))
    expect(preview?.getAttribute('style')).toContain('--brand-primary: #4f7259')
    expect(preview?.getAttribute('style')).toContain('--brand-background: #f5f8f4')
    expect(preview?.getAttribute('style')).toContain('--auth-surface-color: #ffffff')
    expect(preview?.getAttribute('style')).toContain('--auth-text-color: #1e2920')
    expect(preview?.getAttribute('style')).toContain('--auth-border-color: #dde6dd')
    expect(save).toHaveProperty('disabled', false)
    expect(discard).toHaveProperty('disabled', false)

    fireEvent.click(save)
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({
      branding: {
        primaryColor: '#4f7259',
        backgroundColor: '#f5f8f4',
        customCss: '--auth-surface-color: #ffffff; --auth-text-color: #1e2920; --auth-border-color: #dde6dd',
      },
    })
  })

  it('discards unsaved Experience changes through the standard inline form actions', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleSharedFetch)

    renderWithQuery(<ExperiencePage section="theme" />)

    const preview = (await screen.findByLabelText('Acme Auth hosted sign-in preview')).closest('.brandingPreview')
    fireEvent.click(screen.getByRole('button', { name: /Sage/ }))
    expect(preview?.getAttribute('style')).toContain('--brand-primary: #4f7259')

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(preview?.getAttribute('style')).toContain(`--brand-primary: ${brandingSettings.branding.primaryColor}`)
    expect(screen.getByRole('button', { name: 'Discard' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true)
  })

  it('supports the five-token custom scheme and restores every saved theme color', async () => {
    const customBranding = {
      ...brandingSettings,
      branding: {
        ...brandingSettings.branding,
        primaryColor: '#135f5a',
        backgroundColor: '#fbfefd',
        customCss: '--auth-surface-color: #ffffff; --auth-text-color: #18302d; --auth-border-color: #bdd7d2',
      },
    }
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/branding') return Promise.resolve(jsonResponse(customBranding))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="theme" />)

    expect(await screen.findByLabelText('Primary')).toHaveProperty('value', '#135f5a')
    expect(screen.getByLabelText('Page background')).toHaveProperty('value', '#fbfefd')
    expect(screen.getByLabelText('Surface')).toHaveProperty('value', '#ffffff')
    expect(screen.getByLabelText('Text')).toHaveProperty('value', '#18302d')
    expect(screen.getByLabelText('Border')).toHaveProperty('value', '#bdd7d2')

    fireEvent.click(screen.getByRole('button', { name: /Indigo/ }))
    fireEvent.click(screen.getByRole('button', { name: /Custom/ }))
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: '#12524e' } })
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
      if (url === '/api/realm/branding') return Promise.resolve(jsonResponse(defaultBranding))
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(defaultSignIn))
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="theme" />)

    expect((await screen.findByRole('button', { name: /Clear Aqua/ })).getAttribute('aria-pressed')).toBe('true')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Brand assets' }), { button: 0, ctrlKey: false })
    expect(await screen.findByLabelText('Logo URL')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Favicon URL')).toHaveProperty('value', '')
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Legal & support' }), { button: 0, ctrlKey: false })
    expect(await screen.findByLabelText('Terms URL')).toHaveProperty('value', '')
  })

  it('retries all hosted experience dependencies after a load failure', async () => {
    let attempts = 0
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      if (String(input) === '/api/realm/branding') {
        attempts += 1
        return attempts === 1
          ? Promise.resolve(jsonResponse({ error: { message: 'Experience unavailable.' } }, 503))
          : Promise.resolve(jsonResponse(brandingSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="theme" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Color scheme' })).toBeTruthy()
    expect(attempts).toBe(2)
  })

  it('updates brand asset URLs in the preview and falls back cleanly', async () => {
    vi.spyOn(window, 'fetch').mockImplementation(consoleSharedFetch)

    renderWithQuery(<ExperiencePage section="theme" />)
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

    expect(screen.queryByLabelText('Upload logo')).toBeNull()
    expect(screen.queryByLabelText('Upload favicon')).toBeNull()
  })

  it('keeps the preview consistent with unsaved sign-in method controls [spec: connectors-and-methods/hosted-preview-consistency]', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if ((url === '/api/realm/sign-in-policy' || url === '/api/realm/security-policy') && init?.method === 'PATCH') {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return Promise.resolve(jsonResponse(url.endsWith('policy') ? securityPolicy : signInSettings))
      }
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [], pagination: { ...pagination, totalItems: 0 } }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<SignInSettingsPage />)
    const preview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
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
      url: '/api/realm/sign-in-policy',
      body: expect.objectContaining({
        signIn: expect.objectContaining({ passwordEnabled: false, emailOtpEnabled: true, socialLoginEnabled: false }),
      }),
    })
  })

  it('persists legal and support destinations without exposing custom copy controls [spec: admin-console/admin-content-settings]', async () => {
    const requests: unknown[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url = String(input)
      if (url === '/api/realm/sign-in-policy' && init?.method === 'PATCH') {
        requests.push(JSON.parse(String(init.body)))
        return Promise.resolve(jsonResponse(signInSettings))
      }
      if (url === '/api/realm/branding' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse(brandingSettings))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="legal" />)
    expect(await screen.findByLabelText('Terms URL')).toBeTruthy()
    expect(screen.queryByLabelText('Sign-in message')).toBeNull()
    expect(screen.queryByLabelText('Sign-up message')).toBeNull()
    fireEvent.change(screen.getByLabelText('Terms URL'), {
      target: { value: 'https://northstar.example.com/terms' },
    })
    fireEvent.change(screen.getByLabelText('Privacy URL'), {
      target: { value: 'https://northstar.example.com/privacy' },
    })
    fireEvent.change(screen.getByLabelText('Support URL'), {
      target: { value: 'https://northstar.example.com/support' },
    })

    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('https://northstar.example.com/terms')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(requests).toEqual([
        {
          links: {
            termsUri: 'https://northstar.example.com/terms',
            privacyUri: 'https://northstar.example.com/privacy',
            supportUri: 'https://northstar.example.com/support',
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
      if (url === '/api/realm/sign-in-policy') return Promise.resolve(jsonResponse(oneTapSettings))
      if (url === '/api/connectors') {
        return Promise.resolve(jsonResponse({ items: [], pagination: { ...pagination, totalItems: 0 } }))
      }
      return consoleSharedFetch(input, init)
    })

    renderWithQuery(<ExperiencePage section="legal" />)
    const preview = await screen.findByLabelText('Acme Auth hosted sign-in preview')
    expect(within(preview).getByRole('button', { name: 'Continue with OneTap' })).toBeTruthy()
    expect(within(preview).queryByText('No sign-in methods are enabled.')).toBeNull()
  })
})
