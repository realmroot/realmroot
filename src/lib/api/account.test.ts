import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createAccountConnection,
  createPasskeyRegistrationOptions,
  decideAgentResourceApproval,
  deleteAgent,
  getAccountProfile,
  getAgentResourceApproval,
  linkAccount,
  listAccountAgents,
  listAccountConnections,
  listApprovalAccountConnections,
  listApprovalAuthorizationDetailCatalog,
  listExternalApiResources,
  revokeAccountConnection,
  verifyPasskeyRegistration,
} from '@/lib/api/account'

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
    await account.listAccountApplicationAuthorizations()
    await account.revokeAccountApplicationAuthorization('authorization-1')
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
      ['applicationAuthorizations.get', { query: {} }],
      ['applicationAuthorization.delete', { param: { authorizationId: 'authorization-1' } }],
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

  it('uses auth-client status metadata when an Organization request fails', async () => {
    vi.doUnmock('@/lib/api')
    vi.doMock('@/lib/auth-client', () => ({
      authClient: {
        organization: {
          list: vi.fn().mockResolvedValue({ data: null, error: { statusText: 'Organization service unavailable.' } }),
        },
      },
      nativeAuth: vi.fn(),
    }))
    const { listAccountOrganizations } = await import('@/lib/api/account')
    await expect(listAccountOrganizations()).rejects.toMatchObject({
      message: 'Organization service unavailable.',
      status: 500,
    })
  })
})

const base = 'http://localhost:3000'
const realClientServer = setupServer()

describe('account API client over the real network boundary', () => {
  beforeAll(() => realClientServer.listen({ onUnhandledRequest: 'error' }))
  afterEach(() => realClientServer.resetHandlers())
  afterAll(() => realClientServer.close())

  it('lists and deletes stable Agents', async () => {
    realClientServer.use(
      http.get(`${base}/api/account/agents`, () =>
        HttpResponse.json({
          items: [{ id: 'ag1' }],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
        }),
      ),
      http.delete(`${base}/api/account/agents/:agentId`, () => new HttpResponse(null, { status: 204 })),
    )
    expect((await listAccountAgents()).items).toEqual([{ id: 'ag1' }])
    expect(await deleteAgent('ag1')).toBeUndefined()
  })

  it('links a social provider via the native sign-in endpoint', async () => {
    let body: unknown = null
    realClientServer.use(
      http.post(`${base}/api/auth/link-social`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ url: '/social-redirect' })
      }),
    )
    const result = await linkAccount({ providerType: 'social', providerId: 'github', callbackURL: '/cb' })
    expect(result).toEqual({ url: '/social-redirect' })
    expect((body as { provider: string }).provider).toBe('github')
  })

  it('links a generic oauth provider via the oauth2 link endpoint', async () => {
    let body: unknown = null
    realClientServer.use(
      http.post(`${base}/api/auth/oauth2/link`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ url: '/oauth-redirect' })
      }),
    )
    const result = await linkAccount({
      providerType: 'generic_oauth',
      providerId: 'custom',
      callbackURL: '/cb',
      scopes: ['email'],
    })
    expect(result).toEqual({ url: '/oauth-redirect' })
    expect((body as { providerId: string }).providerId).toBe('custom')
  })

  it('builds the register-options query and posts verification', async () => {
    const captured: { url: URL | null; body: unknown } = { url: null, body: null }
    realClientServer.use(
      http.get(`${base}/api/auth/passkey/generate-register-options`, ({ request }) => {
        captured.url = new URL(request.url)
        return HttpResponse.json({ challenge: 'abc' })
      }),
      http.post(`${base}/api/auth/passkey/verify-registration`, async ({ request }) => {
        captured.body = await request.json()
        return HttpResponse.json({ verified: true })
      }),
    )
    await createPasskeyRegistrationOptions({
      name: 'Key',
      authenticatorAttachment: 'platform',
      context: 'account',
    })
    expect(captured.url?.searchParams.get('name')).toBe('Key')
    expect(captured.url?.searchParams.get('authenticatorAttachment')).toBe('platform')
    expect(captured.url?.searchParams.get('context')).toBe('account')

    expect(await verifyPasskeyRegistration({ response: { id: 'cred' } })).toEqual({ verified: true })
    expect(captured.body).toEqual({ response: { id: 'cred' } })
  })

  it('manages external resource connections and Agent approvals', async () => {
    const requests: Array<{ url: URL; method: string; body: unknown }> = []
    realClientServer.use(
      http.get(`${base}/api/account/api-resources`, () =>
        HttpResponse.json({
          items: [],
          pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
        }),
      ),
      http.get(`${base}/api/account/account-connections`, () =>
        HttpResponse.json({
          items: [],
          pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
        }),
      ),
      http.post(`${base}/api/account/account-connections`, async ({ request }) => {
        requests.push({ url: new URL(request.url), method: request.method, body: await request.json() })
        return HttpResponse.json({ id: 'connection-1' })
      }),
      http.delete(`${base}/api/account/account-connections/:connectionId`, ({ request }) => {
        requests.push({ url: new URL(request.url), method: request.method, body: null })
        return new HttpResponse(null, { status: 204 })
      }),
      http.get(`${base}/api/account/access-requests`, ({ request }) => {
        requests.push({ url: new URL(request.url), method: request.method, body: null })
        return HttpResponse.json({
          items: [{ id: 'request-1' }],
          pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
        })
      }),
      http.get(`${base}/api/account/access-requests/:requestId/authorization-detail-catalog`, ({ request }) => {
        requests.push({ url: new URL(request.url), method: request.method, body: null })
        return HttpResponse.json({
          items: [],
          pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
        })
      }),
      http.put(`${base}/api/account/access-requests/:requestId/decision`, async ({ request }) => {
        requests.push({ url: new URL(request.url), method: request.method, body: await request.json() })
        return HttpResponse.json({ id: 'request-1', status: 'approved' })
      }),
    )

    await expect(listExternalApiResources()).resolves.toMatchObject({ items: [] })
    await expect(listAccountConnections()).resolves.toMatchObject({ items: [] })
    await expect(listApprovalAccountConnections('approval token')).resolves.toMatchObject({ items: [] })
    await expect(
      createAccountConnection({
        context: 'resource',
        apiResourceId: 'resource-1',
        owner: { type: 'user' },
        scopes: ['projects:read'],
      }),
    ).resolves.toMatchObject({ id: 'connection-1' })
    await expect(revokeAccountConnection('connection/1')).resolves.toBeUndefined()
    await expect(getAgentResourceApproval('approval token')).resolves.toMatchObject({ id: 'request-1' })
    await expect(listApprovalAuthorizationDetailCatalog('request/1', 'approval token')).resolves.toMatchObject({
      items: [],
    })
    await expect(
      decideAgentResourceApproval('request/1', 'approval token', { decision: 'approve', mode: 'once' }),
    ).resolves.toMatchObject({ status: 'approved' })

    expect(requests).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ apiResourceId: 'resource-1' }),
      }),
      expect.objectContaining({
        method: 'DELETE',
        url: expect.objectContaining({ pathname: expect.stringContaining('connection%2F1') }),
      }),
      expect.objectContaining({
        method: 'GET',
        url: expect.objectContaining({ search: '?approvalToken=approval%20token' }),
      }),
      expect.objectContaining({
        method: 'GET',
        url: expect.objectContaining({
          pathname: expect.stringContaining('request%2F1/authorization-detail-catalog'),
          search: '?approvalToken=approval+token&limit=100&offset=0',
        }),
      }),
      expect.objectContaining({
        method: 'PUT',
        url: expect.objectContaining({ pathname: expect.stringContaining('request%2F1') }),
        body: { approvalToken: 'approval token', decision: 'approve', mode: 'once' },
      }),
    ])
  })

  it('delegates failed connection revocation responses to the JSON error reader', async () => {
    realClientServer.use(
      http.delete(`${base}/api/account/account-connections/:connectionId`, () =>
        HttpResponse.json({ error: 'already revoked' }, { status: 409 }),
      ),
    )
    await expect(revokeAccountConnection('connection-1')).rejects.toThrow('already revoked')
  })

  it('omits the register-options query string when no options are provided', async () => {
    const captured: { url: URL | null } = { url: null }
    realClientServer.use(
      http.get(`${base}/api/auth/passkey/generate-register-options`, ({ request }) => {
        captured.url = new URL(request.url)
        return HttpResponse.json({ challenge: 'abc' })
      }),
    )
    await createPasskeyRegistrationOptions({})
    expect(captured.url?.search).toBe('')
  })

  it('surfaces a structured error message from a failed response', async () => {
    realClientServer.use(
      http.get(`${base}/api/account/profile`, () => HttpResponse.json({ error: 'forbidden' }, { status: 403 })),
    )
    await expect(getAccountProfile()).rejects.toThrow('forbidden')
  })
})

async function loadAccountApi() {
  vi.resetModules()
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
          'application-authorizations': {
            $get: endpoint('applicationAuthorizations.get'),
            ':authorizationId': { $delete: endpoint('applicationAuthorization.delete') },
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
