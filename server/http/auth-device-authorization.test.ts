import { oauthProvider } from '@better-auth/oauth-provider'
import { createDeviceAuthorizationOptions } from '@server/auth'
import type { ApplicationAggregate } from '@server/usecases/ports'
import { deviceCodeGrantType } from '@shared/api/applications'
import { betterAuth } from 'better-auth'
import { deviceAuthorization, jwt } from 'better-auth/plugins'
import { describe, expect, it } from 'vitest'

const grantType = 'urn:ietf:params:oauth:grant-type:device_code'

type TestAuth = {
  handler: (request: Request) => Response | Promise<Response>
}

describe('auth device authorization endpoints', () => {
  it('issues Better Auth device codes only for eligible public native clients [spec: management-api/management-native-device-approval]', async () => {
    const auth = createDeviceAuth({
      clients: {
        native: deviceApplication({ clientId: 'native' }),
        'missing-grant': deviceApplication({ clientId: 'missing-grant', allowedGrantTypes: ['authorization_code'] }),
        spa: deviceApplication({ clientId: 'spa', clientType: 'public_spa' }),
        confidential: deviceApplication({ clientId: 'confidential', clientType: 'confidential_web', public: false }),
        disabled: deviceApplication({ clientId: 'disabled', disabled: true }),
      },
    })

    const success = await requestJson(auth, '/device/code', {
      client_id: 'native',
      scope: 'openid profile email offline_access',
    })

    expect(success.status).toBe(200)
    await expect(success.json()).resolves.toMatchObject({
      device_code: 'device-code-1',
      user_code: 'USERCODE',
      verification_uri: 'https://auth.example.com/device',
      verification_uri_complete: 'https://auth.example.com/device?user_code=USERCODE',
      expires_in: 1800,
      interval: 5,
    })

    for (const client_id of ['missing-grant', 'spa', 'confidential', 'disabled', 'missing']) {
      const response = await requestJson(auth, '/device/code', { client_id, scope: 'openid' })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'invalid_client' })
    }

    const disallowedScope = await requestJson(auth, '/device/code', { client_id: 'native', scope: 'management:read' })
    expect(disallowedScope.status).toBe(400)
    await expect(disallowedScope.json()).resolves.toMatchObject({
      error: 'invalid_request',
      error_description: 'Scope is not allowed for this client: management:read',
    })
  })

  it('returns pending and slow_down while the device code waits for browser approval', async () => {
    const auth = createDeviceAuth()
    await requestJson(auth, '/device/code', { client_id: 'native', scope: 'openid email' })

    const pending = await pollDeviceToken(auth)
    expect(pending.status).toBe(400)
    await expect(pending.json()).resolves.toMatchObject({ error: 'authorization_pending' })

    const slowDown = await pollDeviceToken(auth)
    expect(slowDown.status).toBe(400)
    await expect(slowDown.json()).resolves.toMatchObject({ error: 'slow_down' })
  })

  it('returns Better Auth bearer token material after signed-in approval without OIDC token claims', async () => {
    const auth = createDeviceAuth()
    await requestJson(auth, '/device/code', { client_id: 'native', scope: 'openid email offline_access' })
    const cookie = await createBrowserSession(auth)

    const verify = await requestJson(auth, '/device?user_code=USERCODE', undefined, { method: 'GET', cookie })
    expect(verify.status).toBe(200)
    await expect(verify.json()).resolves.toMatchObject({ user_code: 'USERCODE', status: 'pending' })

    const approval = await requestJson(auth, '/device/approve', { userCode: 'USER-CODE' }, { cookie })
    expect(approval.status).toBe(200)
    await expect(approval.json()).resolves.toEqual({ success: true })

    const token = await pollDeviceToken(auth)
    expect(token.status).toBe(200)
    const body = (await token.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      access_token: expect.any(String),
      token_type: 'Bearer',
      scope: 'openid email offline_access',
    })
    expect(body).not.toHaveProperty('id_token')
    expect(body).not.toHaveProperty('refresh_token')
  })

  it('exchanges approved device codes through the OAuth token endpoint with OIDC token material', async () => {
    const auth = createDeviceOAuthAuth()
    const client = await registerDeviceClient(auth)

    const code = await requestJson(auth, '/device/code', {
      client_id: client.client_id,
      scope: 'openid email offline_access',
    })
    expect(code.status).toBe(200)
    await expect(code.json()).resolves.toMatchObject({
      device_code: 'device-code-1',
      user_code: 'USERCODE',
    })

    const cookie = await createBrowserSession(auth)
    const verify = await requestJson(auth, '/device?user_code=USERCODE', undefined, { method: 'GET', cookie })
    expect(verify.status).toBe(200)
    const approval = await requestJson(auth, '/device/approve', { userCode: 'USERCODE' }, { cookie })
    expect(approval.status).toBe(200)

    const token = await requestForm(auth, '/oauth2/token', {
      grant_type: grantType,
      client_id: client.client_id,
      device_code: 'device-code-1',
      resource: 'https://auth.example.com/api/auth',
    })
    expect(token.status).toBe(200)
    const body = (await token.json()) as Record<string, string>
    expect(body).toMatchObject({
      token_type: 'Bearer',
      scope: 'openid email offline_access',
    })
    expect(body.access_token.split('.')).toHaveLength(3)
    expect(body.id_token.split('.')).toHaveLength(3)
    expect(body.refresh_token).toEqual(expect.any(String))
  })

  it('returns pending and slow_down errors through the OAuth token endpoint', async () => {
    const auth = createDeviceOAuthAuth()
    const client = await registerDeviceClient(auth)
    await requestOAuthDeviceCode(auth, client.client_id)

    const pending = await pollOAuthDeviceToken(auth, client.client_id)
    expect(pending.status).toBe(400)
    await expect(pending.json()).resolves.toMatchObject({ error: 'authorization_pending' })

    const slowDown = await pollOAuthDeviceToken(auth, client.client_id)
    expect(slowDown.status).toBe(400)
    await expect(slowDown.json()).resolves.toMatchObject({ error: 'slow_down' })
  })

  it('returns denial and expiration errors through the OAuth token endpoint', async () => {
    const deniedAuth = createDeviceOAuthAuth()
    const deniedClient = await registerDeviceClient(deniedAuth)
    await requestOAuthDeviceCode(deniedAuth, deniedClient.client_id)
    const deniedCookie = await createBrowserSession(deniedAuth)
    await requestJson(deniedAuth, '/device?user_code=USERCODE', undefined, { method: 'GET', cookie: deniedCookie })
    const denial = await requestJson(deniedAuth, '/device/deny', { userCode: 'USERCODE' }, { cookie: deniedCookie })
    expect(denial.status).toBe(200)

    const deniedToken = await pollOAuthDeviceToken(deniedAuth, deniedClient.client_id)
    expect(deniedToken.status).toBe(400)
    await expect(deniedToken.json()).resolves.toMatchObject({ error: 'access_denied' })

    const expiredAuth = createDeviceOAuthAuth({ expiresIn: '1s' })
    const expiredClient = await registerDeviceClient(expiredAuth)
    await requestOAuthDeviceCode(expiredAuth, expiredClient.client_id)
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const expiredToken = await pollOAuthDeviceToken(expiredAuth, expiredClient.client_id)
    expect(expiredToken.status).toBe(400)
    await expect(expiredToken.json()).resolves.toMatchObject({ error: 'expired_token' })
  })

  it('rejects OAuth device-code polling for client mismatch and disallowed grants', async () => {
    const mismatchAuth = createDeviceOAuthAuth()
    const codeClient = await registerDeviceClient(mismatchAuth, { client_name: 'Code Client' })
    const pollingClient = await registerDeviceClient(mismatchAuth, { client_name: 'Polling Client' })
    await requestOAuthDeviceCode(mismatchAuth, codeClient.client_id)

    const mismatch = await pollOAuthDeviceToken(mismatchAuth, pollingClient.client_id)
    expect(mismatch.status).toBe(400)
    await expect(mismatch.json()).resolves.toMatchObject({ error: 'invalid_grant' })

    const grantAuth = createDeviceOAuthAuth()
    const clientWithoutGrant = await registerDeviceClient(grantAuth, {
      grant_types: ['authorization_code'],
      response_types: ['code'],
    })
    await requestOAuthDeviceCode(grantAuth, clientWithoutGrant.client_id)

    const disallowedGrant = await pollOAuthDeviceToken(grantAuth, clientWithoutGrant.client_id)
    expect(disallowedGrant.status).toBe(400)
    await expect(disallowedGrant.json()).resolves.toMatchObject({ error: 'invalid_client' })
  })

  it('returns denial and expiration polling errors through the Better Auth token endpoint', async () => {
    const deniedAuth = createDeviceAuth()
    await requestJson(deniedAuth, '/device/code', { client_id: 'native', scope: 'openid' })
    const cookie = await createBrowserSession(deniedAuth)
    await requestJson(deniedAuth, '/device?user_code=USERCODE', undefined, { method: 'GET', cookie })
    const denial = await requestJson(deniedAuth, '/device/deny', { userCode: 'USERCODE' }, { cookie })
    expect(denial.status).toBe(200)

    const deniedToken = await pollDeviceToken(deniedAuth)
    expect(deniedToken.status).toBe(400)
    await expect(deniedToken.json()).resolves.toMatchObject({ error: 'access_denied' })

    const expiredAuth = createDeviceAuth({ expiresIn: '1s' })
    await requestJson(expiredAuth, '/device/code', { client_id: 'native', scope: 'openid' })
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const expiredToken = await pollDeviceToken(expiredAuth)
    expect(expiredToken.status).toBe(400)
    await expect(expiredToken.json()).resolves.toMatchObject({ error: 'expired_token' })
  })
})

function createDeviceAuth(options: { clients?: Record<string, ApplicationAggregate>; expiresIn?: '1s' | '30m' } = {}) {
  const clients = options.clients ?? { native: deviceApplication({ clientId: 'native' }) }
  const repository = {
    findByClientId: async (clientId: string) => clients[clientId] ?? null,
  }

  return betterAuth({
    appName: 'FlareAuth',
    secret: '01234567890123456789012345678901abcdef',
    baseURL: 'https://auth.example.com/api/auth',
    emailAndPassword: {
      enabled: true,
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    plugins: [
      deviceAuthorization({
        verificationUri: '/device',
        expiresIn: options.expiresIn ?? '30m',
        interval: '5s',
        deviceCodeLength: 12,
        userCodeLength: 8,
        generateDeviceCode: async () => 'device-code-1',
        generateUserCode: async () => 'USERCODE',
        schema: {},
        ...createDeviceAuthorizationOptions(repository),
      }),
    ],
  })
}

function createDeviceOAuthAuth(options: { expiresIn?: '1s' | '30m' } = {}) {
  return betterAuth({
    appName: 'FlareAuth',
    secret: '01234567890123456789012345678901abcdef',
    baseURL: 'https://auth.example.com/api/auth',
    trustedOrigins: ['https://auth.example.com'],
    emailAndPassword: {
      enabled: true,
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    plugins: [
      jwt({
        jwt: {
          issuer: 'https://auth.example.com/api/auth',
          audience: 'https://auth.example.com/api/auth',
          sign: async (payload) => testJwt(payload),
        },
        jwks: {
          remoteUrl: 'https://auth.example.com/api/auth/jwks',
          keyPairConfig: {
            alg: 'EdDSA',
          },
        },
      }),
      deviceAuthorization({
        verificationUri: '/device',
        expiresIn: options.expiresIn ?? '30m',
        deviceCodeLength: 12,
        userCodeLength: 8,
        generateDeviceCode: async () => 'device-code-1',
        generateUserCode: async () => 'USERCODE',
        validateClient: async () => true,
        schema: {},
      }),
      oauthProvider({
        loginPage: '/auth/sign-in',
        consentPage: '/oauth/consent',
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        scopes: ['openid', 'profile', 'email', 'offline_access'],
        silenceWarnings: {
          oauthAuthServerConfig: true,
          openidConfig: true,
        },
      }),
    ],
  })
}

function testJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA', typ: 'JWT' })}.${encode(payload)}.test-signature`
}

async function registerDeviceClient(
  auth: TestAuth,
  overrides: Partial<{
    client_name: string
    grant_types: string[]
    response_types: string[]
  }> = {},
) {
  const response = await requestJson(auth, '/oauth2/register', {
    client_name: overrides.client_name ?? 'Native Device Client',
    redirect_uris: ['com.example.app:/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: overrides.grant_types ?? [grantType],
    response_types: overrides.response_types ?? [],
    scope: 'openid email offline_access',
    type: 'native',
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<{ client_id: string }>
}

async function createBrowserSession(auth: TestAuth) {
  const response = await requestJson(auth, '/sign-up/email', {
    email: `user-${crypto.randomUUID()}@example.com`,
    name: 'Device User',
    password: 'password123',
  })
  expect(response.status).toBe(200)
  return getCookieHeader(response)
}

async function pollDeviceToken(auth: ReturnType<typeof createDeviceAuth>) {
  return requestJson(auth, '/device/token', {
    grant_type: grantType,
    client_id: 'native',
    device_code: 'device-code-1',
  })
}

async function requestOAuthDeviceCode(auth: TestAuth, clientId: string) {
  const response = await requestJson(auth, '/device/code', {
    client_id: clientId,
    scope: 'openid email offline_access',
  })
  expect(response.status).toBe(200)
  return response
}

async function pollOAuthDeviceToken(auth: TestAuth, clientId: string) {
  return requestForm(auth, '/oauth2/token', {
    grant_type: grantType,
    client_id: clientId,
    device_code: 'device-code-1',
  })
}

async function requestJson(
  auth: TestAuth,
  path: string,
  body?: unknown,
  options: { method?: string; cookie?: string } = {},
) {
  return auth.handler(
    new Request(`https://auth.example.com/api/auth${path}`, {
      method: options.method ?? 'POST',
      headers: {
        Origin: 'https://auth.example.com',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

async function requestForm(auth: TestAuth, path: string, body: Record<string, string>) {
  return auth.handler(
    new Request(`https://auth.example.com/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    }),
  )
}

function getCookieHeader(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies =
    headers.getSetCookie !== undefined
      ? headers.getSetCookie()
      : (response.headers.get('set-cookie') ?? '').split(/,(?=\s*__Secure-)/)
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

function deviceApplication(overrides: Partial<ApplicationAggregate> = {}): ApplicationAggregate {
  return {
    id: 'app-1',
    slug: 'native',
    name: 'Native Client',
    description: null,
    homepageUrl: null,
    iconUrl: null,
    clientId: 'native',
    clientType: 'public_native',
    public: true,
    firstParty: false,
    trusted: false,
    systemManaged: false,
    disabled: false,
    disabledReason: null,
    redirectUris: ['com.example.app:/callback'],
    postLogoutRedirectUris: [],
    corsOrigins: [],
    customData: {},
    allowedGrantTypes: ['authorization_code', deviceCodeGrantType],
    allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
    requirePkce: true,
    tokenEndpointAuthMethod: 'none',
    oidcClaims: {
      accessToken: {},
      idToken: {},
      userInfo: {},
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}
