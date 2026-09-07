import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsentPage } from './consent-page'
import { OAuthContextPage } from './oauth-context-page'
import { EmailVerificationPage, ForgotPasswordPage } from './pages/recovery'
import { SignUpPage } from './pages/sign-up'

const config = { branding: {}, copy: {}, links: {}, signIn: {} }
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('[spec: hosted-auth/authorization-unavailable-contexts] expected authorization failures', () => {
  it('explains empty authorization Contexts and prevents approval', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/context?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
    )
    vi.spyOn(window, 'fetch').mockImplementation(async (input) =>
      Response.json(
        String(input).includes('/api/configz')
          ? config
          : { application: { name: 'Client' }, authorizationContexts: [] },
      ),
    )
    render(<OAuthContextPage />)
    expect(await screen.findByText(/No authorization Contexts are available/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Use a different account' })).toBeTruthy()
  })

  it.each([ConsentPage, OAuthContextPage])('offers account switching after a visibility failure', async (Page) => {
    window.history.replaceState(
      null,
      '',
      '/auth/consent?client_id=client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback',
    )
    vi.spyOn(window, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/api/configz')) return Response.json(config)
      if (String(input).includes('/sign-out'))
        return Response.json({ error: { message: 'Unable to switch accounts.' } }, { status: 500 })
      return Response.json({ error: { message: 'Resource is not visible to this account.' } }, { status: 403 })
    })
    render(<Page />)
    expect(await screen.findByText('Resource is not visible to this account.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Use a different account' }))
    expect(await screen.findByText('Unable to switch accounts.')).toBeTruthy()
  })

  it.each([
    SignUpPage,
    ForgotPasswordPage,
    EmailVerificationPage,
  ])('surfaces unavailable configuration before enabling forms', async (Page) => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      Response.json({ error: { message: 'Sign-in settings are unavailable.' } }, { status: 503 }),
    )
    render(<Page />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sign-in settings are unavailable.')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
