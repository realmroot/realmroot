import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('account API client', () => {
  it('maps account helpers to the Hono RPC boundary', async () => {
    const { account, calls } = await loadAccountApi()

    await account.getAccountProfile()
    await account.updateAccountProfile({ displayName: 'Jane Doe' })
    await account.uploadAccountAvatar(new File(['avatar'], 'avatar.png'))
    await account.requestAccountEmailChange({ email: 'new@example.com' })
    await account.changeAccountPassword({ currentPassword: 'old-password', newPassword: 'new-password' })
    await account.listLinkedAccounts()
    await account.linkWalletAddress({
      message: 'Sign this message.',
      signature: '0xsignature',
      walletAddress: '0x0000000000000000000000000000000000000001',
      chainId: 1,
    })
    await account.unlinkWalletAddress('siwe:1:0x0000000000000000000000000000000000000001')
    await account.unlinkAccount('google', 'google-account-1')
    await account.listConsentedApplications()
    await account.revokeApplicationConsent('consent-1')
    await account.listAccountSessions()
    await account.getAccountSecurity()
    await account.startTotpEnrollment({ password: 'password' })
    await account.verifyTotp({ code: '123456' })
    await account.disableTotp({ password: 'password' })
    await account.listPasskeys()
    await account.createPasskeyRegistrationOptions({ name: 'Laptop' })
    await account.verifyPasskeyRegistration({ id: 'credential-1' })
    await account.deletePasskey('passkey-1')
    await account.revokeOtherSessions()
    await account.revokeSession('session-1')

    expect(calls).toEqual([
      ['profile.get'],
      ['profile.patch', { json: { displayName: 'Jane Doe' } }],
      ['upload', '/api/account/avatar', expect.any(File)],
      ['emailChange.post', { json: { email: 'new@example.com' } }],
      ['passwordChange.post', { json: { currentPassword: 'old-password', newPassword: 'new-password' } }],
      ['linkedAccounts.get'],
      [
        'walletAddress.post',
        {
          json: {
            message: 'Sign this message.',
            signature: '0xsignature',
            walletAddress: '0x0000000000000000000000000000000000000001',
            chainId: 1,
          },
        },
      ],
      ['walletAddress.delete', { param: { accountId: 'siwe:1:0x0000000000000000000000000000000000000001' } }],
      ['linkedAccounts.delete', { param: { providerId: 'google' }, query: { accountId: 'google-account-1' } }],
      ['applications.get'],
      ['applicationConsent.delete', { param: { consentId: 'consent-1' } }],
      ['sessions.get'],
      ['security.get'],
      ['totpEnrollment.post', { json: { password: 'password' } }],
      ['totpVerification.post', { json: { code: '123456' } }],
      ['totp.delete', { json: { password: 'password' } }],
      ['passkeys.get'],
      [
        'fetch',
        '/api/auth/passkey/generate-register-options?name=Laptop',
        { method: 'GET', credentials: 'same-origin' },
      ],
      [
        'fetch',
        '/api/auth/passkey/verify-registration',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'credential-1' }),
        },
      ],
      ['passkey.delete', { param: { id: 'passkey-1' } }],
      ['securitySessions.delete'],
      ['securitySession.delete', { param: { sessionId: 'session-1' } }],
    ])
  })
})

async function loadAccountApi() {
  const calls: Array<[string, ...unknown[]]> = []
  const endpoint = (key: string) =>
    vi.fn((input?: unknown) => {
      calls.push(input === undefined ? [key] : [key, input])
      return Promise.resolve({ key, input })
    })

  vi.doMock('@/lib/api', () => ({
    apiClient: {
      api: {
        account: {
          profile: {
            $get: endpoint('profile.get'),
            $patch: endpoint('profile.patch'),
          },
          email: { change: { $post: endpoint('emailChange.post') } },
          password: { change: { $post: endpoint('passwordChange.post') } },
          'linked-accounts': {
            $get: endpoint('linkedAccounts.get'),
            ':providerId': { $delete: endpoint('linkedAccounts.delete') },
          },
          'wallet-addresses': {
            $post: endpoint('walletAddress.post'),
            ':accountId': { $delete: endpoint('walletAddress.delete') },
          },
          applications: {
            $get: endpoint('applications.get'),
            ':consentId': { $delete: endpoint('applicationConsent.delete') },
          },
          sessions: { $get: endpoint('sessions.get') },
          security: {
            $get: endpoint('security.get'),
            mfa: {
              'totp-enrollment': { $post: endpoint('totpEnrollment.post') },
              'totp-verification': { $post: endpoint('totpVerification.post') },
              totp: { $delete: endpoint('totp.delete') },
            },
            passkeys: {
              $get: endpoint('passkeys.get'),
              ':id': { $delete: endpoint('passkey.delete') },
            },
            sessions: {
              $delete: endpoint('securitySessions.delete'),
              ':sessionId': { $delete: endpoint('securitySession.delete') },
            },
          },
        },
      },
    },
    readRpcResponse: (response: unknown) => response,
    readJsonResponse: (response: unknown) => response,
    uploadApiFile: (path: string, file: File) => {
      calls.push(['upload', path, file])
      return Promise.resolve({ asset: { id: 'asset-1' } })
    },
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      calls.push(['fetch', path, init])
      return Promise.resolve({ path, init })
    }),
  )

  return {
    calls,
    account: await import('@/lib/api/account'),
  }
}
