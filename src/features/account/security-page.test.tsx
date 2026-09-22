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

async function openSecurityTab(name: 'MFA' | 'Passkeys' | 'Sessions' | 'Wallet') {
  const existing = screen.queryByRole('button', { name: 'Done' })
  if (existing) fireEvent.click(existing)
  const labels = {
    MFA: 'Manage authenticator',
    Passkeys: 'Manage passkeys',
    Sessions: 'Manage sessions',
    Wallet: 'Manage wallet',
  }
  fireEvent.click(await screen.findByRole('button', { name: labels[name] }))
  await waitFor(() => expect(screen.queryAllByText('Loading security settings')).toHaveLength(0))
}

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  success.mockClear()
  errorToast.mockClear()
  Object.assign(store, createAccountStore())
})
afterAll(() => server.close())

describe('AccountSecurityPage', () => {
  it('renders the security panels with password, MFA, passkeys, and sessions', async () => {
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByRole('button', { name: /Change password/ })).toBeTruthy()
    expect((await screen.findByRole('link', { name: 'Manage Connections' })).getAttribute('href')).toBe('/connections')
    await openSecurityTab('MFA')
    expect(screen.getByText('Multi-factor authentication')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Set up authenticator app/ })).toBeTruthy()
    await openSecurityTab('Passkeys')
    expect(screen.getByText('No passkeys have been added yet.')).toBeTruthy()
    await openSecurityTab('Sessions')
    expect(screen.getByText('No other active sessions.')).toBeTruthy()
  })

  it('shows active Provider sign-in and unlinks a wallet credential', async () => {
    store.linkedAccounts = [
      {
        id: 'wallet-1',
        accountId: '0x1111111111111111111111111111111111111111',
        providerId: 'siwe',
        createdAt: '2026-08-08T00:00:00.000Z',
      },
    ]
    let unlinked = false
    server.use(
      http.get(`${base}/api/account/provider-connections`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'provider-connection-1',
              connector: {
                id: 'connector-1',
                slug: 'github',
                providerId: 'github',
                providerType: 'social',
                displayName: 'GitHub',
                capabilities: {
                  signIn: { available: true },
                  agentAccess: { available: false },
                  connection: { method: 'sign_in' },
                },
              },
              displayName: 'Octocat',
              externalSubject: 'octocat',
              capabilities: {
                signIn: { available: true, active: true },
                agentAccess: { available: false, active: false, authorizationCount: 0, resourceNames: [] },
              },
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination: { page: Math.floor(0 / 50) + 1, pageSize: 50, totalItems: 1, totalPages: Math.ceil(1 / 50) },
        }),
      ),
      http.delete(`${base}/api/account/wallet-addresses/:accountId`, () => {
        unlinked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('GitHub')).toBeTruthy()
    await openSecurityTab('Wallet')
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink wallet' }))
    await waitFor(() => expect(unlinked).toBe(true))
  })

  it('surfaces a missing wallet provider when linking a wallet', async () => {
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('Wallet')
    fireEvent.click(await screen.findByRole('button', { name: 'Link wallet' }))
    await waitFor(() => expect(errorToast).toHaveBeenCalled())
  })

  it('renders an error state when a security request fails', async () => {
    server.use(http.get(`${base}/api/account/security`, () => HttpResponse.json({ error: 'no' }, { status: 500 })))
    renderWithClient(<AccountSecurityPage />)
    expect((await screen.findAllByText('no')).length).toBeGreaterThan(0)
  })

  it('keeps the Account Center shell visible while a Security tab loads', async () => {
    let finishSecurityRequest!: () => void
    server.use(
      http.get(`${base}/api/account/security`, async () => {
        await new Promise<void>((resolve) => {
          finishSecurityRequest = resolve
        })
        return HttpResponse.json({ security: store.security })
      }),
    )
    renderWithClient(<AccountSecurityPage />)

    expect(await screen.findByRole('heading', { name: 'Account settings' })).toBeTruthy()

    expect((await screen.findAllByText('Loading security settings')).length).toBeGreaterThan(0)
    expect(screen.getByRole('navigation', { name: 'Account Center' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeTruthy()

    finishSecurityRequest()
    expect(await screen.findByText('Authenticator app')).toBeTruthy()
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
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-1' } })
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
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password-1' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    await waitFor(() => expect(screen.getByText('Wrong password.')).toBeTruthy())
  })

  it('rejects a mismatched password confirmation before submission', async () => {
    let requests = 0
    server.use(
      http.post(`${base}/api/account/password/change`, () => {
        requests += 1
        return HttpResponse.json({ ok: true })
      }),
    )
    renderWithClient(<AccountSecurityPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Change password/ }))
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password-1' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)

    expect(await screen.findByText('New passwords do not match.')).toBeTruthy()
    expect(requests).toBe(0)
  })

  it('enrolls TOTP then verifies the authenticator code', async () => {
    server.use(
      http.post(`${base}/api/account/security/mfa/totp-enrollment`, () =>
        HttpResponse.json({ totpURI: 'otpauth://x', secret: 'SEKRET', backupCodes: ['code-1'] }),
      ),
      http.post(`${base}/api/account/security/mfa/totp-verification`, () => HttpResponse.json({ ok: true })),
    )
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)

    await waitFor(() => expect(success).toHaveBeenCalledWith('TOTP enrollment started.'))
    expect(await screen.findByAltText('Authenticator app QR code')).toBeTruthy()
    expect(await screen.findByText('SEKRET')).toBeTruthy()
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('MFA enabled.'))
    expect(await screen.findByRole('heading', { name: 'Save backup codes' })).toBeTruthy()
    expect(screen.getByText('code-1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Save backup codes' })).toBeNull())
  })

  it('verifies an MFA challenge for an enrolled account', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    server.use(http.post(`${base}/api/account/security/mfa/totp-verification`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('MFA')
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
    await openSecurityTab('MFA')
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
    await openSecurityTab('Passkeys')
    expect(await screen.findByText('My Key')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove passkey' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Passkey removed.'))
  })

  it('renames one of multiple passkeys and refreshes the drawer [spec: account-center/passkey-flow]', async () => {
    store.passkeys = [
      { id: 'key-1', name: 'Laptop', deviceType: 'multiDevice', backedUp: true, createdAt: null },
      { id: 'key-2', name: 'Backup key', deviceType: 'singleDevice', backedUp: false, createdAt: null },
    ]
    const rename = vi.fn()
    server.use(
      http.patch(`${base}/api/account/security/passkeys/:id`, async ({ request, params }) => {
        const body = (await request.json()) as { name: string }
        rename(params.id, body.name)
        store.passkeys[0]!.name = body.name
        return HttpResponse.json({ status: true })
      }),
    )
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('Passkeys')
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!)
    fireEvent.change(screen.getByLabelText('Passkey name'), { target: { value: 'Personal laptop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rename).toHaveBeenCalledWith('key-1', 'Personal laptop'))
    expect(await screen.findByText('Personal laptop')).toBeTruthy()
    expect(screen.getByText('Backup key')).toBeTruthy()
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
    await openSecurityTab('Passkeys')
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
    await openSecurityTab('Sessions')
    expect(await screen.findByText('Chrome on macOS')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke session' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Session revoked.'))
  })

  it('marks the current session without presenting a duplicate revoke action', async () => {
    const withSession = createAccountStore()
    withSession.sessions = [
      { id: 'sess-current', userAgent: null, ipAddress: null, expiresAt: '2026-02-01T00:00:00.000Z', current: true },
    ]
    Object.assign(store, withSession)
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('Sessions')
    expect((await screen.findAllByText('Unknown device')).length).toBeGreaterThan(0)
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('revokes all other sessions', async () => {
    server.use(http.delete(`${base}/api/account/security/sessions`, () => HttpResponse.json({ ok: true })))
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('Sessions')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out others' }))
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
    await openSecurityTab('MFA')
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
    await openSecurityTab('MFA')
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
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/ }))
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
    await openSecurityTab('Passkeys')
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
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    expect(await screen.findByAltText('Authenticator app QR code')).toBeTruthy()
    expect(screen.getByText('otpauth://abc')).toBeTruthy()
  })

  it('renders QR-only enrollment details when no manual setup value is returned', async () => {
    server.use(
      http.post(`${base}/api/account/security/mfa/totp-enrollment`, () =>
        HttpResponse.json({ qrCode: 'data:image/png;base64,QR' }),
      ),
    )
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]') as HTMLElement)
    expect(await screen.findByAltText('Authenticator app QR code')).toBeTruthy()
    expect(screen.queryByText('Manual setup key')).toBeNull()
    expect(screen.queryByText('Enrollment URI')).toBeNull()
  })

  it('cancels the TOTP enroll, verify, disable, and passkey dialogs', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    renderWithClient(<AccountSecurityPage />)

    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: 'Verify code' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Authenticator code')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())

    await openSecurityTab('Passkeys')
    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Passkey name')).toBeNull())
    expect(success).not.toHaveBeenCalled()
  })

  it('resets MFA and passkey editor state when dialogs are dismissed from their close control', async () => {
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/ }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'temporary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())

    await openSecurityTab('Passkeys')
    fireEvent.click(screen.getByRole('button', { name: /Add passkey/ }))
    fireEvent.change(await screen.findByLabelText('Passkey name'), { target: { value: 'Temporary key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByLabelText('Passkey name')).toBeNull())
  })

  it('resets verify and disable credentials when enrolled MFA dialogs are dismissed', async () => {
    const enrolled = createAccountStore()
    enrolled.security.mfa.enabled = true
    Object.assign(store, enrolled)
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByLabelText('Authenticator code')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'temporary' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())
  })

  it('cancels the TOTP enroll dialog and clears enrollment', async () => {
    renderWithClient(<AccountSecurityPage />)
    await openSecurityTab('MFA')
    fireEvent.click(await screen.findByRole('button', { name: /Set up authenticator app/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())
  })

  it('hides the sessions panel when sessions view is disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, sessionsViewEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByRole('button', { name: 'Manage authenticator' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Manage sessions' })).toBeNull()
  })

  it('hides the password panel when password change is disabled', async () => {
    const disabled = configz()
    disabled.accountCenter = { ...disabled.accountCenter, passwordChangeEnabled: false }
    server.use(http.get(`${base}/api/configz`, () => HttpResponse.json(disabled)))
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByRole('button', { name: 'Manage authenticator' })).toBeTruthy()
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
    await openSecurityTab('Passkeys')
    expect(await screen.findByText('2 registered keys, managed individually.')).toBeTruthy()
    expect(screen.getByText('Unnamed passkey')).toBeTruthy()
  })

  it('uses empty collection fallbacks when optional security payload fields are absent', async () => {
    const sparseConfig = configz()
    Object.assign(sparseConfig, {
      identityProviders: undefined,
      builtInProviders: { ...sparseConfig.builtInProviders, web3Wallet: undefined },
    })
    server.use(
      http.get(`${base}/api/configz`, () => HttpResponse.json(sparseConfig)),
      http.get(`${base}/api/account/security`, () => HttpResponse.json({})),
      http.get(`${base}/api/account/security/passkeys`, () => HttpResponse.json({})),
      http.get(`${base}/api/account/sessions`, () => HttpResponse.json({})),
      http.get(`${base}/api/account/linked-accounts`, () => HttpResponse.json({})),
    )
    renderWithClient(<AccountSecurityPage />)
    expect(await screen.findByText('No external sign-in Providers')).toBeTruthy()
    await openSecurityTab('Passkeys')
    expect(screen.getByText('No passkeys have been added yet.')).toBeTruthy()
    await openSecurityTab('Sessions')
    expect(screen.getByText('No other active sessions.')).toBeTruthy()
  })
})
