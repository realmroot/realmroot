import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CaptchaTokenField,
  navigateAfterAuth,
  redirectToMissingEmailSignUp,
  SignInMethodButtons,
  SocialButtons,
} from '@/features/auth/pages/controls'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const providers = [{ slug: 'github', providerId: 'github', displayName: 'GitHub', icon: 'github' }]

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  assign = vi.fn()
  vi.stubGlobal('location', {
    ...window.location,
    assign,
    pathname: '/auth/sign-in',
    origin: 'https://auth.example.com',
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.turnstile
  for (const script of document.querySelectorAll('script[data-turnstile-script="true"]')) script.remove()
  window.history.pushState(null, '', '/')
})

describe('redirectToMissingEmailSignUp', () => {
  it('navigates to the callback page with the missing-email error', () => {
    redirectToMissingEmailSignUp()
    expect(assign).toHaveBeenCalledTimes(1)
    const target = assign.mock.calls[0][0] as string
    expect(target.startsWith('/auth/callback?')).toBe(true)
    expect(target).toContain('error=missing_email_signup')
  })
})

describe('navigateAfterAuth', () => {
  it('redirects to the resolved destination', () => {
    navigateAfterAuth({ url: '/profile' }, undefined)
    expect(assign).toHaveBeenCalledWith('/profile')
  })

  it('does not navigate when already on the resolved path', () => {
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/profile' })
    navigateAfterAuth({ url: '/profile' }, undefined)
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('SignInMethodButtons', () => {
  it('renders nothing when no methods are available', () => {
    const { container } = render(
      <SignInMethodButtons
        callback={undefined}
        emailEnabled={false}
        onEmailClick={() => undefined}
        oneTapEnabled={false}
        passkeyEnabled={false}
        phoneEnabled={false}
        phoneVisible={false}
        providers={[]}
        walletEnabled={false}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('delegates social provider clicks to onProviderClick when provided', () => {
    const onProviderClick = vi.fn()
    render(
      <SignInMethodButtons
        callback={undefined}
        emailEnabled={false}
        onEmailClick={() => undefined}
        onProviderClick={onProviderClick}
        phoneEnabled={false}
        phoneVisible={false}
        providers={providers}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    expect(onProviderClick).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'github' }))
  })

  it('falls back to the social sign-in network flow without an onProviderClick handler', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ url: 'https://github.com/login/oauth' }))

    render(<SocialButtons callback="/dashboard" providers={providers} />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth'))
  })
})

describe('CaptchaTokenField', () => {
  const captchaConfig = {
    captcha: { enabled: true, provider: 'turnstile', siteKey: 'site-key-1' },
  } as unknown as Parameters<typeof CaptchaTokenField>[0]['config']

  it('renders nothing when captcha is disabled', () => {
    const { container } = render(
      <CaptchaTokenField
        config={{ captcha: { enabled: false, provider: 'turnstile', siteKey: '' } } as typeof captchaConfig}
        onChange={() => undefined}
      />,
    )
    expect(container.querySelector('.sr-only')).toBeNull()
  })

  it('clears the token through the error callback when the widget errors', async () => {
    const onChange = vi.fn()
    window.turnstile = {
      render: vi.fn((_element, options) => {
        options['error-callback']()
        return 'widget-1'
      }),
      remove: vi.fn(),
    }

    render(<CaptchaTokenField config={captchaConfig} onChange={onChange} />)

    await waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledWith('')
  })

  // Runs last: the module-level script promise singleton is rejected here, so no
  // later test in this file should depend on a fresh turnstile script load.
  it('clears the token when the turnstile script fails to load', async () => {
    const onChange = vi.fn()
    render(<CaptchaTokenField config={captchaConfig} onChange={onChange} />)

    await waitFor(() => expect(document.querySelector('script[data-turnstile-script="true"]')).toBeTruthy())
    const script = document.querySelector<HTMLScriptElement>('script[data-turnstile-script="true"]')!
    script.dispatchEvent(new Event('error'))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''))
  })
})
