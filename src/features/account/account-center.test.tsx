import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import {
  AccountCenter,
  AccountCenterPage,
  asRecord,
  base64UrlToBuffer,
  bufferToBase64Url,
  formatSessionDevice,
  readChainId,
  readFirstString,
  readRedirectUrl,
  readRequiredString,
  readString,
} from './account-center'

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}))

afterEach(() => {
  cleanup()
  navigateMock.mockReset()
  delete window.ethereum
  vi.restoreAllMocks()
})

describe('account center', () => {
  it('normalizes account center helper values', () => {
    expect(bufferToBase64Url(new Uint8Array([251, 255]).buffer)).toBe('-_8')
    expect(Array.from(new Uint8Array(base64UrlToBuffer('-_8')))).toEqual([251, 255])
    expect(asRecord({ id: 'value' })).toEqual({ id: 'value' })
    expect(asRecord(null)).toEqual({})
    expect(readString('value')).toBe('value')
    expect(readString('')).toBeNull()
    expect(readFirstString(['first'])).toBe('first')
    expect(readFirstString([1])).toBeNull()
    expect(readChainId(1)).toBe(1)
    expect(readChainId('0x2105')).toBe(8453)
    expect(readChainId('10')).toBe(10)
    expect(() => readChainId(null)).toThrow('Wallet did not return a chain ID.')
    expect(readRequiredString('challenge', 'challenge')).toBe('challenge')
    expect(() => readRequiredString('', 'challenge')).toThrow('Passkey registration option challenge is required.')
    expect(readRedirectUrl({ url: '/profile' })).toBe('/profile')
    expect(readRedirectUrl({ redirectTo: '/settings' })).toBe('/settings')
    expect(readRedirectUrl({ callbackURL: '/callback' })).toBe('/callback')
    expect(readRedirectUrl({ url: 1 })).toBeNull()
    expect(formatSessionDevice(null)).toBe('Unknown device')
    expect(formatSessionDevice('Custom Agent')).toBe('Custom Agent')
    expect(formatSessionDevice('Mozilla/5.0 (Mac OS X) Chrome/120')).toBe('Chrome on macOS')
    expect(formatSessionDevice('Mozilla/5.0 (Windows NT 10.0) Edg/120')).toBe('Edge on Windows')
    expect(formatSessionDevice('Mozilla/5.0 (Android 14) Firefox/120')).toBe('Firefox on Android')
    expect(formatSessionDevice('Mozilla/5.0 (iPhone) Safari/605')).toBe('Safari on iOS')
    expect(formatSessionDevice('Mozilla/5.0 Unknown/1.0')).toBe('Browser session')
  })

  it('loads profile, security, session, connection, and application sections', async () => {
    mockAccountFetch({ image: 'https://auth.example.com/api/assets/avatar.png' })

    render(<AccountCenterWithToaster />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Account center' })).toBeNull()
    expect(document.querySelectorAll('.accountContent')).toHaveLength(1)
    expect(document.querySelectorAll('.accountSectionStack')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Account details' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Password' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Passkeys' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Linked accounts' })).toBeTruthy()
    expect(screen.getByText('Google')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getByText('Linked')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.queryByText('credential')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Active sessions' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Authorized apps' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Delegated agents' })).toBeTruthy()
    expect(screen.getByText('Desktop Agent')).toBeTruthy()
    expect(screen.getByText(/Desktop Host/)).toBeTruthy()
    expect(screen.getAllByText(/account.profile.read/).length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.accountPanelGroup')).toHaveLength(4)
    expect(document.querySelectorAll('.accountPanelGroup .settingsPanel')).toHaveLength(9)
    expect(screen.getByRole('region', { name: 'Profile settings' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Security settings' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Social and app access' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Session management' })).toBeTruthy()

    expect(screen.queryByLabelText('Display name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    await waitFor(() => expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Jane Stone'))
    expect(document.querySelector('img.assetPreview')?.getAttribute('width')).toBe('56')
    expect(document.querySelector('img.assetPreview')?.getAttribute('height')).toBe('56')
  })

  it('reflects account center visibility and field permissions from configz', async () => {
    mockAccountFetch(
      {},
      {
        accountCenter: {
          profileEditingEnabled: true,
          displayNameEditable: false,
          usernameEditable: false,
          avatarEditable: false,
          emailChangeEnabled: false,
          passwordChangeEnabled: false,
          connectedAccountsEnabled: false,
          sessionsViewEnabled: false,
          dangerZoneEnabled: false,
        },
      },
    )

    render(<AccountCenterWithToaster />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    const fetchedPaths = vi.mocked(window.fetch).mock.calls.map(([input]) => String(input))
    expect(fetchedPaths).not.toContain('/api/account/linked-accounts')
    expect(fetchedPaths).not.toContain('/api/account/applications')
    expect(fetchedPaths).not.toContain('/api/account/sessions')
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy()
    expect(screen.queryByLabelText('Display name')).toBeNull()
    expect(screen.queryByLabelText('Avatar image')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Identifiers' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Password' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Linked accounts' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Authorized apps' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Sessions and devices' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Multi-factor authentication' })).toBeTruthy()
  })

  it('keeps password changes visible when profile editing is disabled independently', async () => {
    mockAccountFetch(
      {},
      {
        accountCenter: {
          ...defaultAccountCenterSettings,
          profileEditingEnabled: false,
          passwordChangeEnabled: true,
        },
      },
    )

    render(<AccountCenterWithToaster />)

    expect(await screen.findByRole('heading', { name: 'Jane Stone' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Profile' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Identifiers' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Password' })).toBeTruthy()
  })

  it('surfaces config loading errors before account requests run', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      if (String(input) === '/api/configz') return Promise.reject(new Error('Config unavailable.'))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<AccountCenterWithToaster />)

    expect(await screen.findByText('Config unavailable.')).toBeTruthy()
    const fetchedPaths = vi.mocked(window.fetch).mock.calls.map(([input]) => String(input))
    expect(fetchedPaths).toEqual(['/api/configz'])
  })

  it('updates profile, email, and password from the profile section', async () => {
    const user = userEvent.setup()
    const requests = mockAccountFetch()

    render(<AccountCenterWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    await user.click(screen.getByRole('button', { name: 'Edit profile' }))
    const displayNameInput = (await screen.findByLabelText('Display name')) as HTMLInputElement
    await waitFor(() => expect(displayNameInput.value).toBe('Jane Stone'))
    await user.clear(displayNameInput)
    await user.type(displayNameInput, 'Jane Updated')
    expect(displayNameInput.value).toBe('Jane Updated')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await user.click(screen.getByRole('button', { name: 'Edit username' }))
    const usernameInput = (await screen.findByLabelText('Username')) as HTMLInputElement
    await user.clear(usernameInput)
    expect(usernameInput.value).toBe('')
    await user.click(screen.getByRole('button', { name: 'Save identifiers' }))

    await user.click(screen.getByRole('button', { name: 'Change email' }))
    const emailInput = (await screen.findByLabelText('Email')) as HTMLInputElement
    await user.clear(emailInput)
    await user.type(emailInput, 'new@example.com')
    expect(emailInput.value).toBe('new@example.com')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send code' }))
    const codeInput = (await screen.findByLabelText('Verification code')) as HTMLInputElement
    await user.type(codeInput, '123456')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify code' }))

    await user.click(screen.getByRole('button', { name: 'Change password' }))
    const passwordDialog = screen.getByRole('dialog')
    expect(passwordDialog.querySelector('input[autocomplete="username"]')).toHaveProperty('value', 'jane@example.com')
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password')
    await user.type(screen.getByLabelText('Current password'), 'old-password')
    await user.type(screen.getByLabelText('New password'), 'new-password')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change password' }))

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          {
            path: '/api/account/profile',
            method: 'PATCH',
            body: { displayName: 'Jane Updated', username: 'jane', avatarAssetId: null },
          },
          {
            path: '/api/account/profile',
            method: 'PATCH',
            body: { displayName: 'Jane Stone', username: null, avatarAssetId: null },
          },
          {
            path: '/api/account/email/change',
            method: 'POST',
            body: { email: 'new@example.com' },
          },
          {
            path: '/api/account/email/confirm',
            method: 'POST',
            body: { email: 'new@example.com', otp: '123456' },
          },
          {
            path: '/api/account/password/change',
            method: 'POST',
            body: {
              currentPassword: 'old-password',
              newPassword: 'new-password',
              revokeOtherSessions: true,
            },
          },
        ]),
      )
    })
  })

  it('uploads an avatar from the profile section', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterWithToaster />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
    const avatarInput = (await screen.findByLabelText('Avatar image')) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }))
    const requestsBeforeEmptySelection = requests.length
    fireEvent.change(avatarInput, {
      target: { files: [] },
    })
    expect(requests).toHaveLength(requestsBeforeEmptySelection)

    fireEvent.change(avatarInput, {
      target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] },
    })

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/account/avatar',
        method: 'POST',
        body: '[form-data]',
      })
    })
  })

  it('signs out from the top-level account page without reloading protected account data', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    const accountGetCount = vi.mocked(window.fetch).mock.calls.filter(([input, init]) => {
      const path = String(input)
      return (init?.method ?? 'GET') === 'GET' && path.startsWith('/api/account/')
    }).length
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/auth/sign-out',
        method: 'POST',
        body: {},
      })
    })
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/sign-in' })
      expect(screen.queryByRole('heading', { name: 'Jane Stone' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'MFA' })).toBeNull()
    })
    expect(
      vi.mocked(window.fetch).mock.calls.filter(([input, init]) => {
        const path = String(input)
        return (init?.method ?? 'GET') === 'GET' && path.startsWith('/api/account/')
      }),
    ).toHaveLength(accountGetCount)
  })

  it('shows the sign-out error message when sign-out fails with an Error', async () => {
    mockAccountFetch({}, { signOutFailure: new Error('Sign-out unavailable.') })

    render(<AccountCenterWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Sign-out unavailable.')).toBeTruthy()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('shows the fallback sign-out error when sign-out fails with a non-Error value', async () => {
    mockAccountFetch({}, { signOutFailure: 'network-down' })

    render(<AccountCenterWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Account update failed.')).toBeTruthy()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('shows TOTP enrollment setup data before verification', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Enroll authenticator app' }))
    expect(document.querySelector('input[autocomplete="username"][type="text"][hidden]')).toHaveProperty(
      'value',
      'jane@example.com',
    )
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enroll authenticator app' }))

    expect(await screen.findByText('Authenticator setup')).toBeTruthy()
    expect(screen.getByAltText('Authenticator app QR code').getAttribute('width')).toBe('168')
    expect(screen.getByAltText('Authenticator app QR code').getAttribute('height')).toBe('168')
    expect(screen.getByText('otpauth://totp/Acme:jane@example.com?secret=ABC123')).toBeTruthy()
    expect(screen.getByText('ABC123')).toBeTruthy()
    expect(screen.getByText('Backup codes')).toBeTruthy()
    expect(screen.getByText('backup-1')).toBeTruthy()
    expect(screen.getByText('backup-2')).toBeTruthy()
    expect(requests).toContainEqual({
      path: '/api/account/security/mfa/totp-enrollment',
      body: { password: 'password-1' },
      method: 'POST',
    })
  })

  it('completes passkey registration with WebAuthn create and verification', async () => {
    const requests = mockAccountFetch()
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue(passkeyCredential()),
      },
    })

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))
    fireEvent.change(screen.getByLabelText('Passkey name'), { target: { value: 'MacBook Touch ID' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add passkey' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/auth/passkey/generate-register-options?name=MacBook+Touch+ID',
        body: null,
        method: 'GET',
      })
      expect(requests).toContainEqual({
        path: '/api/auth/passkey/verify-registration',
        body: {
          name: 'MacBook Touch ID',
          response: {
            id: 'credential-1',
            rawId: 'AQID',
            type: 'public-key',
            response: {
              attestationObject: 'BAUG',
              clientDataJSON: 'BwgJ',
              transports: ['internal'],
            },
            clientExtensionResults: {},
          },
        },
        method: 'POST',
      })
    })
    expect(navigator.credentials.create).toHaveBeenCalled()
  })

  it('links Web3 wallet from the signed-in account center', async () => {
    const requests = mockAccountFetch({}, { web3WalletEnabled: true })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('0x1')
        if (method === 'personal_sign') return Promise.resolve('0xsignature')
        throw new Error(`Unsupported wallet method ${method}`)
      }),
    }

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    const walletRow = screen.getByText('Web3 wallet').closest('article') as HTMLElement
    fireEvent.click(within(walletRow).getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/auth/siwe/nonce',
        method: 'POST',
        body: { walletAddress: '0x0000000000000000000000000000000000000001', chainId: 1 },
      })
      expect(requests).toContainEqual({
        path: '/api/account/wallet-addresses',
        method: 'POST',
        body: expect.objectContaining({
          signature: '0xsignature',
          walletAddress: '0x0000000000000000000000000000000000000001',
          chainId: 1,
        }),
      })
    })
  })

  it('surfaces Web3 wallet enrollment boundary errors', async () => {
    mockAccountFetch({}, { web3WalletEnabled: true })
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(
      within(screen.getByText('Web3 wallet').closest('article') as HTMLElement).getByRole('button', {
        name: 'Connect',
      }),
    )
    expect(await screen.findByText('No wallet provider was found in this browser.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    mockAccountFetch({}, { web3WalletEnabled: true })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve([])
        throw new Error(`Unsupported wallet method ${method}`)
      }),
    }
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(
      within(screen.getByText('Web3 wallet').closest('article') as HTMLElement).getByRole('button', {
        name: 'Connect',
      }),
    )
    expect(await screen.findByText('No wallet account was selected.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    mockAccountFetch({}, { web3WalletEnabled: true })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve('0x2105')
        throw new Error(`Unsupported wallet method ${method}`)
      }),
    }
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(
      within(screen.getByText('Web3 wallet').closest('article') as HTMLElement).getByRole('button', {
        name: 'Connect',
      }),
    )
    expect(await screen.findByText('This wallet network is not enabled. Switch to chain 1.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    mockAccountFetch({}, { web3WalletEnabled: true })
    window.ethereum = {
      request: vi.fn().mockImplementation(({ method }) => {
        if (method === 'eth_requestAccounts') return Promise.resolve(['0x0000000000000000000000000000000000000001'])
        if (method === 'eth_chainId') return Promise.resolve(1)
        if (method === 'personal_sign') return Promise.resolve(null)
        throw new Error(`Unsupported wallet method ${method}`)
      }),
    }
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(
      within(screen.getByText('Web3 wallet').closest('article') as HTMLElement).getByRole('button', {
        name: 'Connect',
      }),
    )
    expect(await screen.findByText('Wallet did not return a signature.')).toBeTruthy()
  })

  it('surfaces unsupported and canceled passkey registration errors', async () => {
    mockAccountFetch()
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {},
    })

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add passkey' }))
    expect(await screen.findByText('Passkey registration is not supported by this browser.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    mockAccountFetch()
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue(null),
      },
    })

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add passkey' }))
    expect(await screen.findByText('Passkey registration was cancelled.')).toBeTruthy()
  })

  it('surfaces invalid passkey registration options', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const path = String(input)
      if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (path === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile() }))
      if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: linkedAccounts() }))
      if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: applications() }))
      if (path === '/api/account/agents')
        return Promise.resolve(jsonResponse({ agents: accountAgents(), pagination: pagination() }))
      if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: sessions() }))
      if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security: security() }))
      if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: passkeys() }))
      if (path === '/api/auth/passkey/generate-register-options') {
        return Promise.resolve(
          jsonResponse({
            rp: { name: 'Acme ID', id: 'localhost' },
            user: { id: 'BAUG', name: 'jane@example.com', displayName: 'Jane Stone' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn(),
      },
    })

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add passkey' }))
    expect(await screen.findByText('Passkey registration option challenge is required.')).toBeTruthy()
    expect(navigator.credentials.create).not.toHaveBeenCalled()
  })

  it('manages MFA verification, linked accounts, sessions, passkeys, and application consent display', async () => {
    const requests = mockAccountFetch(
      {},
      {
        security: { ...security(), mfa: { enabled: true, factors: [] } },
      },
    )

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Laptop key')).toBeTruthy()
    expect(screen.getByText(/1 passkey added/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disable MFA' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Disable authenticator app' }))
    clickAndConfirm('Remove', 'Remove passkey')

    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Google')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    clickAndConfirm('Unlink', 'Unlink account')

    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Chrome on macOS')).toBeTruthy()
    clickAndConfirm('Revoke other sessions', 'Revoke sessions')
    clickAndConfirm('Revoke', 'Revoke session', 3)

    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Customer Portal')).toBeTruthy()
    expect(screen.getByText(/openid, email/)).toBeTruthy()
    clickAndConfirm('Revoke', 'Revoke access')

    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('Desktop Agent')).toBeTruthy()
    clickAndConfirm('Revoke', 'Revoke access', 2)

    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    clickAndConfirm('Revoke', 'Revoke grant', 1)

    await waitFor(() => {
      expect(requests).toEqual(
        expect.arrayContaining([
          {
            path: '/api/account/security/mfa/totp-verification',
            method: 'POST',
            body: { code: '123456', trustDevice: true },
          },
          { path: '/api/account/security/mfa/totp', method: 'DELETE', body: { password: 'password-1' } },
          { path: '/api/account/security/passkeys/passkey-1', method: 'DELETE', body: null },
          {
            path: '/api/auth/link-social',
            method: 'POST',
            body: {
              provider: 'github',
              callbackURL: 'http://localhost:3000/profile/linked-accounts',
              errorCallbackURL: 'http://localhost:3000/profile',
            },
          },
          { path: '/api/account/linked-accounts/google?accountId=google-account-1', method: 'DELETE', body: null },
          { path: '/api/account/security/sessions', method: 'DELETE', body: null },
          { path: '/api/account/security/sessions/session-1', method: 'DELETE', body: null },
          { path: '/api/account/applications/consent-1', method: 'DELETE', body: null },
          { path: '/api/account/agents/agent-1', method: 'DELETE', body: null },
          { path: '/api/account/agent-capability-grants/grant-1', method: 'DELETE', body: null },
        ]),
      )
    })
  })

  it('does not run destructive account mutations when confirmation is canceled', async () => {
    const requests = mockAccountFetch()

    render(<AccountCenterOnlyWithToaster />)

    await screen.findByRole('heading', { name: 'Jane Stone' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke' }).at(-1) as HTMLButtonElement)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(requests.some((request) => request.method === 'DELETE')).toBe(false))
  })

  it('surfaces load and mutation failures', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const path = String(input)
      if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (path === '/api/account/profile' && init?.method === 'PATCH') {
        return Promise.resolve(jsonResponse({ error: { message: 'Profile rejected.' } }, 400))
      }
      if (path === '/api/account/profile') return Promise.resolve(jsonResponse({ user: profile() }))
      if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
      if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
      if (path === '/api/account/agents') return Promise.resolve(jsonResponse({ agents: [], pagination: pagination() }))
      if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: [] }))
      if (path === '/api/account/security') return Promise.resolve(jsonResponse({ security: security() }))
      if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: [] }))
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    render(<AccountCenterWithToaster />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save profile' }))

    expect(await screen.findByText('Profile rejected.')).toBeTruthy()

    cleanup()
    vi.restoreAllMocks()
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      if (String(input) === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      return Promise.resolve(jsonResponse({ error: { message: 'Account unavailable.' } }, 503))
    })

    render(<AccountCenterWithToaster />)

    expect(await screen.findByText('Account unavailable.')).toBeTruthy()
  })

  it('renders account center fallback states and alternate security enrollment fields', async () => {
    const requests: RequestRecord[] = []
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (method !== 'GET' || path.startsWith('/api/auth/passkey/')) requests.push({ path, method, body })
      if (path === '/api/configz') return Promise.resolve(jsonResponse(configz()))
      if (path === '/api/account/profile') {
        return Promise.resolve(jsonResponse({ user: { ...profile(), emailVerified: false, username: null } }))
      }
      if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: [] }))
      if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: [] }))
      if (path === '/api/account/agents') return Promise.resolve(jsonResponse({ agents: [], pagination: pagination() }))
      if (path === '/api/account/sessions') {
        return Promise.resolve(jsonResponse({ sessions: [{ ...sessions()[0], ipAddress: null, userAgent: null }] }))
      }
      if (path === '/api/account/security') {
        return Promise.resolve(jsonResponse({ security: security() }))
      }
      if (path === '/api/account/security/passkeys') {
        return Promise.resolve(jsonResponse({ passkeys: [{ ...passkeys()[0], name: null, backedUp: false }] }))
      }
      if (path === '/api/account/security/mfa/totp-enrollment') {
        return Promise.resolve(
          jsonResponse({
            qrCodeUrl: 'data:image/png;base64,ZmFrZQ',
            totpUri: 'otpauth://totp/Acme:jane@example.com?secret=XYZ789',
            secret: 'XYZ789',
          }),
        )
      }
      if (path === '/api/auth/passkey/generate-register-options') {
        return Promise.resolve(
          jsonResponse({
            challenge: 'AQID',
            rp: { name: 'Acme ID', id: 'localhost' },
            user: { id: 'BAUG', name: 'jane@example.com', displayName: 'Jane Stone' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            excludeCredentials: [{ id: 'CgsM', type: 'public-key', transports: ['internal'] }],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })
    Object.defineProperty(window.navigator, 'credentials', {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue({
          ...passkeyCredential(),
          response: {
            attestationObject: new Uint8Array([4, 5, 6]).buffer,
            clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
          },
        }),
      },
    })

    render(<AccountCenterOnlyWithToaster />)

    expect(await screen.findByText('Required')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit username' }))
    await waitFor(() => expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe(''))
    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('No authenticator factor enrolled.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Disable MFA' })).toBeNull()
    expect(screen.getByText('Unnamed passkey')).toBeTruthy()
    expect(screen.getByText(/singleDevice/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enroll authenticator app' }))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password-1' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enroll authenticator app' }))
    expect(await screen.findByText('otpauth://totp/Acme:jane@example.com?secret=XYZ789')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add passkey' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add passkey' }))

    await waitFor(() => {
      expect(requests).toContainEqual({
        path: '/api/auth/passkey/generate-register-options',
        method: 'GET',
        body: null,
      })
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: '/api/auth/passkey/verify-registration',
        }),
      )
    })

    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText(/Unknown device/)).toBeTruthy()
    expect(screen.getByText(/No IP/)).toBeTruthy()
    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getAllByText('Not linked to this account.').length).toBeGreaterThan(0)
    cleanup()
    render(<AccountCenterOnlyWithToaster />)
    await screen.findByRole('heading', { name: 'Jane Stone' })
    expect(screen.getByText('No authorized applications yet.')).toBeTruthy()
  })
})

type RequestRecord = {
  path: string
  method: string
  body: unknown
}

function AccountCenterWithToaster() {
  return (
    <>
      <AccountCenterPage />
      <Toaster />
    </>
  )
}

function AccountCenterOnlyWithToaster() {
  return (
    <>
      <AccountCenter />
      <Toaster />
    </>
  )
}

type MockProfile = Omit<ReturnType<typeof profile>, 'image'> & {
  image: string | null
}

function clickAndConfirm(triggerName: string, confirmName: string, index = 0) {
  fireEvent.click(screen.getAllByRole('button', { name: triggerName })[index] as HTMLButtonElement)
  const buttons = screen.getAllByRole('button', { name: confirmName })
  fireEvent.click(buttons.at(-1) as HTMLButtonElement)
}

function mockAccountFetch(
  profileOverrides: Partial<MockProfile> = {},
  options: {
    accountCenter?: ReturnType<typeof configz>['accountCenter']
    security?: ReturnType<typeof security>
    signOutFailure?: unknown
    web3WalletEnabled?: boolean
  } = {},
) {
  const requests: RequestRecord[] = []
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body instanceof FormData ? '[form-data]' : init?.body ? JSON.parse(String(init.body)) : null
    if (method !== 'GET' || path.startsWith('/api/auth/passkey/')) requests.push({ path, method, body })
    if (path === '/api/configz') {
      return Promise.resolve(jsonResponse(configz(options.accountCenter, options.web3WalletEnabled)))
    }
    if (path === '/api/account/profile')
      return Promise.resolve(jsonResponse({ user: { ...profile(), ...profileOverrides } }))
    if (path === '/api/auth/link-social' && method === 'POST') {
      return Promise.resolve(jsonResponse({ url: 'https://github.example.com/oauth' }))
    }
    if (path === '/api/auth/siwe/nonce' && method === 'POST') {
      return Promise.resolve(jsonResponse({ nonce: 'nonce123' }))
    }
    if (path === '/api/account/linked-accounts') return Promise.resolve(jsonResponse({ accounts: linkedAccounts() }))
    if (path === '/api/account/applications') return Promise.resolve(jsonResponse({ applications: applications() }))
    if (path === '/api/account/agents')
      return Promise.resolve(jsonResponse({ agents: accountAgents(), pagination: pagination() }))
    if (path === '/api/account/sessions') return Promise.resolve(jsonResponse({ sessions: sessions() }))
    if (path === '/api/account/security')
      return Promise.resolve(jsonResponse({ security: options.security ?? security() }))
    if (path === '/api/account/security/passkeys') return Promise.resolve(jsonResponse({ passkeys: passkeys() }))
    if (path === '/api/account/security/mfa/totp-enrollment') {
      return Promise.resolve(
        jsonResponse({
          qrCode: 'data:image/png;base64,ZmFrZQ',
          totpURI: 'otpauth://totp/Acme:jane@example.com?secret=ABC123',
          secret: 'ABC123',
          backupCodes: ['backup-1', 'backup-2'],
        }),
      )
    }
    if (
      path === '/api/auth/passkey/generate-register-options' ||
      path.startsWith('/api/auth/passkey/generate-register-options?')
    ) {
      return Promise.resolve(
        jsonResponse({
          challenge: 'AQID',
          rp: { name: 'Acme ID', id: 'localhost' },
          user: { id: 'BAUG', name: 'jane@example.com', displayName: 'Jane Stone' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        }),
      )
    }
    if (path === '/api/account/avatar') {
      return Promise.resolve(
        jsonResponse(
          {
            asset: {
              id: 'asset-1',
              publicUrl: 'https://auth.example.com/api/assets/asset-1',
              contentType: 'image/png',
              byteSize: 6,
              checksumSha256: 'checksum-1',
            },
          },
          201,
        ),
      )
    }
    if (path === '/api/auth/sign-out' && options.signOutFailure !== undefined) {
      return Promise.reject(options.signOutFailure)
    }
    return Promise.resolve(jsonResponse({ ok: true }))
  })
  return requests
}

function configz(
  accountCenter: typeof defaultAccountCenterSettings = defaultAccountCenterSettings,
  web3WalletEnabled = false,
) {
  return {
    onboarding: { required: false, href: '/onboarding' },
    signIn: {
      passwordEnabled: true,
      signupEnabled: true,
      socialLoginEnabled: false,
      emailOtpEnabled: false,
      usernameEnabled: true,
      identifierFirst: false,
    },
    branding: {
      logoUrl: null,
      faviconUrl: null,
      primaryColor: '#b42318',
      backgroundColor: '#f7f3ee',
      customCss: null,
    },
    identityProviders: [
      { slug: 'google', providerType: 'social', providerId: 'google', displayName: 'Google', icon: 'google' },
      { slug: 'github', providerType: 'social', providerId: 'github', displayName: 'GitHub', icon: 'github' },
    ],
    builtInProviders: {
      email: { enabled: true },
      phone: { enabled: false },
      web3Wallet: { enabled: web3WalletEnabled, chains: [1], allowSignUp: true },
      passkey: { allowSignUp: true },
      oneTap: {
        enabled: false,
        clientId: '',
        autoSelect: false,
        cancelOnTapOutside: true,
        uxMode: 'popup',
        context: 'signin',
        promptBaseDelayMs: 1000,
        promptMaxAttempts: 5,
      },
    },
    links: { termsUri: null, privacyUri: null, supportEmail: null },
    copy: {
      productName: 'Acme ID',
      headline: 'Sign in.',
      description: 'Hosted identity.',
    },
    auth: {
      basePath: '/api/auth',
      signInEmailPath: '/api/auth/sign-in/email',
      signInUsernamePath: '/api/auth/sign-in/username',
      signUpEmailPath: '/api/auth/sign-up/email',
      signOutPath: '/api/auth/sign-out',
      requestPasswordResetPath: '/api/auth/request-password-reset',
      resetPasswordPath: '/api/auth/reset-password',
      sendVerificationEmailPath: '/api/auth/send-verification-email',
      verifyEmailPath: '/api/auth/verify-email',
      emailOtpPath: '/api/auth/email-otp/send-verification-otp',
      emailOtpSignInPath: '/api/auth/sign-in/email-otp',
      emailOtpVerificationPath: '/api/auth/email-otp/verify-email',
      emailOtpPasswordResetRequestPath: '/api/auth/email-otp/request-password-reset',
      emailOtpPasswordResetPath: '/api/auth/email-otp/reset-password',
    },
    oidc: {
      issuer: 'https://auth.example.com/api/auth',
      discoveryUrl: 'https://auth.example.com/api/auth/.well-known/openid-configuration',
      authorizationEndpoint: 'https://auth.example.com/api/auth/oauth2/authorize',
      tokenEndpoint: 'https://auth.example.com/api/auth/oauth2/token',
      jwksUri: 'https://auth.example.com/api/auth/jwks',
      userInfoEndpoint: 'https://auth.example.com/api/auth/oauth2/userinfo',
      endSessionEndpoint: 'https://auth.example.com/api/auth/oauth2/logout',
    },
    security: { mfaRequired: false, sessionExpiresInSeconds: 3600, passkeysEnabled: true },
    accountCenter,
  }
}

const defaultAccountCenterSettings = {
  profileEditingEnabled: true,
  displayNameEditable: true,
  usernameEditable: true,
  avatarEditable: true,
  emailChangeEnabled: true,
  passwordChangeEnabled: true,
  connectedAccountsEnabled: true,
  sessionsViewEnabled: true,
  dangerZoneEnabled: false,
}

function profile() {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    emailVerified: true,
    displayName: 'Jane Stone',
    username: 'jane',
    avatarAssetId: null,
    image: null,
  }
}

function linkedAccounts() {
  return [
    { id: 'linked-1', accountId: 'google-account-1', providerId: 'google', createdAt: '2026-01-01T00:00:00.000Z' },
    {
      id: 'linked-credential',
      accountId: 'credential-account-1',
      providerId: 'credential',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]
}

function applications() {
  return [
    {
      id: 'consent-1',
      applicationName: 'Customer Portal',
      applicationSlug: 'customer-portal',
      scopes: ['openid', 'email'],
      grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
    },
  ]
}

function accountAgents() {
  return [
    {
      id: 'agent-1',
      name: 'Desktop Agent',
      hostId: 'host-1',
      host: { id: 'host-1', name: 'Desktop Host', status: 'active' },
      status: 'active',
      mode: 'delegated',
      lastUsedAt: null,
      activatedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      capabilityGrants: [
        {
          id: 'grant-1',
          agentId: 'agent-1',
          capability: 'account.profile.read',
          status: 'active',
          expiresAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ]
}

function pagination() {
  return { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null }
}

function sessions() {
  return [
    {
      id: 'session-1',
      expiresAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      ipAddress: '127.0.0.1',
      userAgent: 'Chrome on macOS',
    },
  ]
}

function passkeys() {
  return [
    {
      id: 'passkey-1',
      name: 'Laptop key',
      deviceType: 'singleDevice',
      backedUp: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]
}

function security() {
  return {
    mfa: { enabled: false, factors: [] },
    passkeys: { enabled: true, count: 0 },
    policy: {
      mfa: { mode: 'optional' },
      passkeys: {
        enabled: true,
        rpName: 'Acme ID',
      },
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function passkeyCredential() {
  return {
    id: 'credential-1',
    rawId: new Uint8Array([1, 2, 3]).buffer,
    type: 'public-key',
    response: {
      attestationObject: new Uint8Array([4, 5, 6]).buffer,
      clientDataJSON: new Uint8Array([7, 8, 9]).buffer,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({}),
  }
}
