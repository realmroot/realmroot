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
    await account.requestAccountEmailChange({ email: 'new@example.com' })
    await account.changeAccountPassword({ currentPassword: 'old-password', newPassword: 'new-password' })
    await account.listLinkedAccounts()
    await account.unlinkAccount('google', 'google-account-1')
    await account.listConsentedApplications()
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
      ['emailChange.post', { json: { email: 'new@example.com' } }],
      ['passwordChange.post', { json: { currentPassword: 'old-password', newPassword: 'new-password' } }],
      ['linkedAccounts.get'],
      ['linkedAccounts.delete', { param: { providerId: 'google' }, query: { accountId: 'google-account-1' } }],
      ['applications.get'],
      ['sessions.get'],
      ['security.get'],
      ['totpEnrollment.post', { json: { password: 'password' } }],
      ['totpVerification.post', { json: { code: '123456' } }],
      ['totp.delete', { json: { password: 'password' } }],
      ['passkeys.get'],
      ['passkeyRegistrationOptions.post', { json: { name: 'Laptop' } }],
      ['passkeyRegistrationVerification.post', { json: { id: 'credential-1' } }],
      ['passkey.delete', { param: { id: 'passkey-1' } }],
      ['securitySessions.delete'],
      ['securitySession.delete', { param: { sessionId: 'session-1' } }],
    ])
  })
})

async function loadAccountApi() {
  const calls: Array<[string, unknown?]> = []
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
          applications: { $get: endpoint('applications.get') },
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
              'registration-options': { $post: endpoint('passkeyRegistrationOptions.post') },
              'registration-verification': { $post: endpoint('passkeyRegistrationVerification.post') },
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
  }))

  return {
    calls,
    account: await import('./account'),
  }
}
