import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  base,
  configz,
  createAccountServer,
  createAccountStore,
  HttpResponse,
  http,
  renderWithClient,
} from './account.test-utils'
import { AccountSecurityPage } from './security-page'

const success = vi.fn()
const errorToast = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => success(...a), error: (...a: unknown[]) => errorToast(...a) },
}))

const signOut = vi.fn().mockResolvedValue({})
vi.mock('@/lib/auth-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-client')>()
  return { ...actual, signOut: () => signOut() }
})

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}))

const store = createAccountStore()
const server = createAccountServer(store)

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  success.mockClear()
  errorToast.mockClear()
  signOut.mockClear()
  Object.assign(store, createAccountStore())
})
afterAll(() => server.close())

describe('AccountSecurityPage', () => {
  it('renders the security panels with password, MFA, passkeys, and sessions', async () => {
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Change password/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Enroll authenticator app/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Active sessions' })).toBeTruthy()
  })

  it('renders an error state when a security request fails', async () => {
    server.use(http.get(`${base}/api/account/security`, () => HttpResponse.json({ error: 'no' }, { status: 500 })))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('no')).toBeTruthy()
  })

  it('shows the account-load error when the profile is missing', async () => {
    server.use(http.get(`${base}/api/account/profile`, () => HttpResponse.json({ user: null })))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('Unable to load account center.')).toBeTruthy()
  })

  it('changes the password through the password dialog', async () => {
    server.use(http.post(`${base}/api/account/password/change`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change password/ }))
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Password changed.'))
  })

  it('cancels the password dialog', async () => {
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change password/ }))
    expect(await screen.findByLabelText('Current password')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Current password')).toBeNull())
  })

  it('surfaces a password change error inside the dialog', async () => {
    server.use(
      http.post(`${base}/api/account/password/change`, () =>
        HttpResponse.json({ error: 'Wrong password.' }, { status: 400 }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change password/ }))
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'bad' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(screen.getByText('Wrong password.')).toBeTruthy())
  })

  it('enrolls TOTP then verifies the authenticator code', async () => {
    server.use(
      http.post(`${base}/api/account/security/mfa/totp-enrollment`, () =>
        HttpResponse.json({ totpURI: 'otpauth://x', secret: 'SEKRET', backupCodes: ['code-1'] }),
      ),
      http.post(`${base}/api/account/security/mfa/totp-verification`, () => HttpResponse.json({ ok: true })),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Enroll authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)

    await waitFor(() => expect(success).toHaveBeenCalledWith('TOTP enrollment started.'))
    expect(await screen.findByText('SEKRET')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('MFA enabled.'))
  })

  it('verifies an MFA challenge for an enrolled account', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    server.use(http.post(`${base}/api/account/security/mfa/totp-verification`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(success).toHaveBeenCalledWith('MFA challenge verified.'))
  })

  it('disables MFA for an enrolled account', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    server.use(http.delete(`${base}/api/account/security/mfa/totp`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disable MFA' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disable authenticator app' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('MFA disabled.'))
  })

  it('removes a passkey through the destructive confirmation dialog', async () => {
    const withPasskey = createAccountStore()
    withPasskey.passkeys = [
      { id: 'pk-1', name: 'My Key', deviceType: 'platform', backedUp: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    Object.assign(store, withPasskey)
    server.use(http.delete(`${base}/api/account/security/passkeys/:id`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('My Key')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Passkey removed.'))
  })

  it('enrolls a passkey from the add-passkey dialog', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'cred-1',
      type: 'public-key',
      rawId: new Uint8Array([1]).buffer,
      response: { attestationObject: new Uint8Array([2]).buffer, clientDataJSON: new Uint8Array([3]).buffer },
    })
    vi.stubGlobal('navigator', { ...navigator, credentials: { create } })
    server.use(
      http.get(`${base}/api/auth/passkey/generate-register-options`, () =>
        HttpResponse.json({
          publicKey: {
            challenge: 'AQID',
            user: { id: 'BAUG', name: 'jane', displayName: 'Jane' },
          },
        }),
      ),
      http.post(`${base}/api/auth/passkey/verify-registration`, () => HttpResponse.json({ verified: true })),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add passkey/ }))
    fireEvent.change(await screen.findByLabelText('Passkey name'), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Passkey enrolled.'))
    vi.unstubAllGlobals()
  })

  it('revokes another session', async () => {
    const withSession = createAccountStore()
    withSession.sessions = [
      {
        id: 'sess-1',
        userAgent: 'Mozilla/5.0 (Mac OS X) Chrome/120',
        ipAddress: '1.2.3.4',
        expiresAt: '2026-02-01T00:00:00.000Z',
        current: false,
      },
    ]
    Object.assign(store, withSession)
    server.use(http.delete(`${base}/api/account/security/sessions/:sessionId`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke session' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Session revoked.'))
  })

  it('revokes the current session and signs out', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const withSession = createAccountStore()
    withSession.sessions = [
      { id: 'sess-current', userAgent: null, ipAddress: null, expiresAt: '2026-02-01T00:00:00.000Z', current: true },
    ]
    Object.assign(store, withSession)
    server.use(http.delete(`${base}/api/account/security/sessions/:sessionId`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('Unknown device')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke session' }))
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/sign-in'))
    vi.unstubAllGlobals()
  })

  it('revokes all other sessions', async () => {
    server.use(http.delete(`${base}/api/account/security/sessions`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke other sessions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke sessions' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Other sessions revoked.'))
  })

  it('keeps the verify dialog open when MFA challenge verification fails', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    server.use(
      http.post(`${base}/api/account/security/mfa/totp-verification`, () =>
        HttpResponse.json({ error: 'Invalid code.' }, { status: 400 }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Invalid code.'))
    expect(screen.getByLabelText('Authenticator code')).toBeTruthy()
  })

  it('keeps the disable dialog open when disabling MFA fails', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    server.use(
      http.delete(`${base}/api/account/security/mfa/totp`, () =>
        HttpResponse.json({ error: 'Wrong password.' }, { status: 400 }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disable MFA' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Disable authenticator app' }))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Wrong password.'))
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })

  it('keeps the enroll dialog open when MFA verification after enrollment fails', async () => {
    server.use(
      http.post(`${base}/api/account/security/mfa/totp-enrollment`, () => HttpResponse.json({ secret: 'SEKRET' })),
      http.post(`${base}/api/account/security/mfa/totp-verification`, () =>
        HttpResponse.json({ error: 'Invalid code.' }, { status: 400 }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Enroll authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    expect(await screen.findByText('SEKRET')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Invalid code.'))
    expect(screen.getByText('SEKRET')).toBeTruthy()
  })

  it('keeps the passkey dialog open when enrollment fails', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      credentials: { create: vi.fn().mockRejectedValue(new Error('Passkey registration was cancelled.')) },
    })
    server.use(
      http.get(`${base}/api/auth/passkey/generate-register-options`, () =>
        HttpResponse.json({ publicKey: { challenge: 'AQID', user: { id: 'BAUG', name: 'j', displayName: 'J' } } }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Add passkey/ }))
    fireEvent.change(await screen.findByLabelText('Passkey name'), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Passkey registration was cancelled.'))
    expect(screen.getByLabelText('Passkey name')).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('renders the QR code and enrollment URI in the setup panel', async () => {
    server.use(
      http.post(`${base}/api/account/security/mfa/totp-enrollment`, () =>
        HttpResponse.json({ qrCode: 'data:image/png;base64,QR', otpAuthUri: 'otpauth://abc' }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Enroll authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    expect(await screen.findByAltText('Authenticator app QR code')).toBeTruthy()
    expect(screen.getByText('otpauth://abc')).toBeTruthy()
  })

  it('cancels the TOTP enroll, verify, disable, and passkey dialogs', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    renderWithClient(<AccountSecurityPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Verify code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Authenticator code')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Passkey name')).toBeNull())
    expect(success).not.toHaveBeenCalled()
  })

  it('cancels the TOTP enroll dialog and clears enrollment', async () => {
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Enroll authenticator app/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())
  })

  it('hides the sessions panel when sessions view is disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, sessionsViewEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Active sessions' })).toBeNull()
  })

  it('hides the password panel when password change is disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, passwordChangeEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Change password/ })).toBeNull()
  })

  it('shows the plural passkey count meta with multiple passkeys', async () => {
    const withPasskeys = createAccountStore()
    withPasskeys.passkeys = [
      { id: 'pk-1', name: 'One', deviceType: 'platform', backedUp: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pk-2', name: null, deviceType: 'cross-platform', backedUp: false, createdAt: null },
    ]
    Object.assign(store, withPasskeys)
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('2 passkeys added for passwordless sign-in.')).toBeTruthy()
    expect(screen.getByText('Unnamed passkey')).toBeTruthy()
  })
})
