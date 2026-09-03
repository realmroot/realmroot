import { configzConfigResponseSchema } from '../shared/api/configz'
import { expect, test } from './fixtures'

test.describe('deployed public surface', { tag: '@production-safe' }, () => {
  test('[spec: platform-onboarding/api-health-smoke] reports service liveness', async ({
    request,
    configuredRealm: _,
  }) => {
    const response = await request.get('/api/health')

    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ ok: true, service: 'realmroot' })
  })

  test('publishes coherent public configuration and OIDC metadata', async ({
    request,
    baseURL,
    configuredRealm: _,
  }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.')
    const origin = new URL(baseURL).origin

    const configResponse = await request.get('/api/configz')
    expect(configResponse.status()).toBe(200)
    const config = configzConfigResponseSchema.parse(await configResponse.json())
    expect(config.oidc.issuer).toBe(`${origin}/api/auth`)
    expect(config.oidc.discoveryUrl).toBe(`${origin}/api/auth/.well-known/openid-configuration`)

    const discoveryResponse = await request.get('/api/auth/.well-known/openid-configuration')
    expect(discoveryResponse.status()).toBe(200)
    const discovery = (await discoveryResponse.json()) as { issuer?: unknown; jwks_uri?: unknown }
    expect(discovery.issuer).toBe(`${origin}/api/auth`)
    expect(discovery.jwks_uri).toBe(`${origin}/api/auth/jwks`)

    const jwksResponse = await request.get('/api/auth/jwks')
    expect(jwksResponse.status()).toBe(200)
    expect(await jwksResponse.json()).toMatchObject({ keys: expect.any(Array) })
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
        version: expect.any(String),
      },
    })
  })
})
