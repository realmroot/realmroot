import { configzConfigResponseSchema } from '../shared/api/configz'
import { realmrootApiVersion } from '../shared/api/openapi'
import { expect, test } from './fixtures'

const expectedVersion = process.env.PVT_EXPECTED_VERSION ?? realmrootApiVersion

test.describe('deployed public surface', { tag: '@production-safe' }, () => {
  test('[spec: platform-onboarding/api-health-smoke] reports service liveness', async ({
    request,
    configuredRealm: _,
  }) => {
    const response = await request.get('/api/health')

    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'realmroot' })
  })

  test('publishes coherent public configuration and discovery metadata', async ({
    request,
    baseURL,
    realmrootTarget,
    configuredRealm: _,
  }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.')
    const origin = new URL(baseURL).origin

    const configResponse = await request.get('/api/configz')
    expect(configResponse.status()).toBe(200)
    const config = configzConfigResponseSchema.parse(await configResponse.json())
    expect(config.oidc.issuer).toBe(`${origin}/api/auth`)
    expect(config.oidc.discoveryUrl).toBe(`${origin}/api/auth/.well-known/openid-configuration`)

    const [oidcResponse, oidcAliasResponse, oauthResponse, resourceResponse, agentResponse] = await Promise.all([
      request.get('/api/auth/.well-known/openid-configuration'),
      request.get('/.well-known/openid-configuration/api/auth'),
      request.get('/.well-known/oauth-authorization-server/api/auth'),
      request.get('/.well-known/oauth-protected-resource/api'),
      request.get('/.well-known/agent-configuration'),
    ])
    for (const [path, response] of [
      ['/api/auth/.well-known/openid-configuration', oidcResponse],
      ['/.well-known/openid-configuration/api/auth', oidcAliasResponse],
      ['/.well-known/oauth-authorization-server/api/auth', oauthResponse],
      ['/.well-known/oauth-protected-resource/api', resourceResponse],
      ['/.well-known/agent-configuration', agentResponse],
    ] as const) {
      expect(response.status(), path).toBe(200)
    }

    const oidc = (await oidcResponse.json()) as Record<string, unknown>
    expect(oidc).toMatchObject({
      issuer: `${origin}/api/auth`,
      authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
      device_authorization_endpoint: `${origin}/api/auth/device/code`,
      token_endpoint: `${origin}/api/auth/oauth2/token`,
      jwks_uri: `${origin}/api/auth/jwks`,
      code_challenge_methods_supported: ['S256'],
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
    })
    expect(await oidcAliasResponse.json()).toEqual(oidc)

    expect(await oauthResponse.json()).toMatchObject({
      issuer: `${origin}/api/auth`,
      authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
      device_authorization_endpoint: `${origin}/api/auth/device/code`,
      token_endpoint: `${origin}/api/auth/oauth2/token`,
      jwks_uri: `${origin}/api/auth/jwks`,
      code_challenge_methods_supported: ['S256'],
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
      agent_profile_uri_template: `${origin}/api/public/agents/{subject}`,
    })

    expect(await resourceResponse.json()).toMatchObject({
      resource: `${origin}/api`,
      authorization_servers: [`${origin}/api/auth`],
      bearer_methods_supported: ['header'],
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
      dpop_bound_access_tokens_required: false,
      scopes_supported: expect.arrayContaining(['agent:read', 'users:read', 'resource-servers:write']),
    })

    expect(await agentResponse.json()).toMatchObject({
      agent_identity_issuer: `${origin}/api/auth`,
      agent_enrollment_endpoint: `${origin}/api/agent/enrollments`,
      agent_endpoint: `${origin}/api/agent`,
      agent_profile_uri_template: `${origin}/api/public/agents/{subject}`,
      agent_token_endpoint: `${origin}/api/auth/oauth2/token`,
      agent_jwks_uri: `${origin}/api/auth/jwks`,
    })

    if (realmrootTarget === 'production') {
      const skillsResponse = await request.get('/.well-known/agent-skills/index.json')
      expect(skillsResponse.status()).toBe(200)
      expect(await skillsResponse.json()).toMatchObject({
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: expect.arrayContaining([
          expect.objectContaining({ name: 'integrate-realmroot-application', type: 'archive' }),
          expect.objectContaining({ name: 'integrate-realmroot-resource-server', type: 'archive' }),
          expect.objectContaining({ name: 'realmroot', type: 'archive' }),
        ]),
      })
    }

    const jwksResponse = await request.get('/.well-known/jwks.json')
    expect(jwksResponse.status()).toBe(200)
    const jwks = (await jwksResponse.json()) as { keys?: Array<{ kid?: unknown; kty?: unknown }> }
    expect(jwks.keys).toBeDefined()
    expect(jwks.keys).not.toHaveLength(0)
    for (const key of jwks.keys ?? []) {
      expect(key.kid).toEqual(expect.any(String))
      expect(key.kty).toEqual(expect.any(String))
    }

    const jwksAliasResponse = await request.get('/api/auth/jwks')
    expect(jwksAliasResponse.status()).toBe(200)
    expect(await jwksAliasResponse.json()).toEqual(jwks)
    expect((await request.head('/.well-known/jwks.json')).status()).toBe(200)
  })

  test('[spec: management-api/management-openapi-discovery] publishes the unified OpenAPI document', async ({
    request,
    configuredRealm: _,
  }) => {
    const response = await request.get('/api/openapi.json')

    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({
      openapi: '3.1.0',
      info: {
        title: 'Realmroot API',
        version: expectedVersion,
      },
    })
  })
})
