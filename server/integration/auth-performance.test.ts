import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { readBuiltInProviderSettings } from '@server/adapters/repos/configz'
import { apiResource, identityProviderConnector } from '@server/db/schema'
import { loadAuthConnectorConfig } from '@server/usecases/connectors'
import { findPlatformOrganization, findRealmrootResourceServer } from '@server/usecases/system-resources'
import { eq } from 'drizzle-orm'
import { decodeProtectedHeader } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseURL, createHarness, signInAdmin } from './harness'

afterEach(async () => {
  vi.restoreAllMocks()
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

describe('[spec: management-api/oauth-resource-initialization]', () => {
  it('does not touch the resource catalog during initialization, discovery, or session reads', async () => {
    const audiences = Array.from({ length: 85 }, (_, i) => `https://api-${i}.example.com`)
    const prepare = vi.spyOn(env.DB, 'prepare')
    const harness = await createHarness({ validAudiences: audiences })
    const metadata = await harness.request('/api/auth/.well-known/openid-configuration')
    expect(metadata.status).toBe(200)
    expect(await metadata.json()).toMatchObject({ issuer: `${baseURL}/api/auth` })
    await harness.request('/api/auth/get-session')
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('"oauth_resource"'))).toHaveLength(0)
    expect(await env.DB.prepare('SELECT count(*) AS n FROM oauth_resource').first('n')).toBe(0)
  })
})

describe('[spec: management-api/jwt-storage-failure]', () => {
  it('preserves D1 failures as server errors and still rejects invalid tokens', async () => {
    const harness = await createHarness()
    const token = (
      await harness.auth.api.signJWT({
        body: { payload: { sub: 'test-app', aud: `${baseURL}/api`, client_id: 'test-client' } },
      })
    ).token
    const verify = (value: string) =>
      harness.auth.api.verifyJWT({ body: { token: value, issuer: `${baseURL}/api/auth`, audience: `${baseURL}/api` } })
    expect((await verify(token)).payload).toMatchObject({ sub: 'test-app' })
    expect((await verify('malformed')).payload).toBeNull()
    const segments = token.split('.')
    segments[2] = `${segments[2]!.startsWith('A') ? 'B' : 'A'}${segments[2]!.slice(1)}`
    expect((await verify(segments.join('.'))).payload).toBeNull()
    const keyId = decodeProtectedHeader(token).kid
    const originalPrepare = env.DB.prepare.bind(env.DB)
    const prepare = vi.spyOn(env.DB, 'prepare').mockImplementation((sql) => {
      if (sql.startsWith('select') && sql.includes('"jwks"')) throw new Error('D1 internal error: controlled fixture')
      return originalPrepare(sql)
    })
    await expect(verify(token)).rejects.toThrow()
    for (const scheme of ['Bearer', 'DPoP']) {
      const response = await harness.request('/api/resource-servers', {
        headers: { authorization: `${scheme} ${token}` },
      })
      expect(response.status).toBe(500)
      expect(response.headers.has('WWW-Authenticate')).toBe(false)
      expect(await response.text()).not.toContain('controlled fixture')
    }
    prepare.mockRestore()
    expect((await verify(token)).payload).toMatchObject({ sub: 'test-app' })
    await env.DB.prepare('UPDATE jwks SET public_key = ? WHERE id = ?').bind('{invalid-json', keyId).run()
    await expect(verify(token)).rejects.toThrow()
  })
})

describe('[spec: connectors-and-methods/authentication-config-loading]', () => {
  it('ignores resource-only connectors and does not decrypt unrelated credentials', async () => {
    const harness = await createHarness()
    for (const authenticationEnabled of [true, false]) {
      await harness.db.insert(identityProviderConnector).values({
        id: authenticationEnabled ? 'login' : 'resource-only',
        slug: authenticationEnabled ? 'google-login' : 'github-resource',
        providerType: 'social',
        providerId: authenticationEnabled ? 'google' : 'github',
        displayName: 'Fixture',
        enabled: true,
        authenticationEnabled,
        clientId: 'login-client',
        clientSecret: authenticationEnabled ? 'login-secret' : 'v1.invalid.secret',
        resourceClientSecret: 'v1.invalid.secret',
        registrationAccessToken: 'v1.invalid.secret',
        resourceRegistrationAccessToken: 'v1.invalid.secret',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    const config = await loadAuthConnectorConfig(harness.deps.connectors)
    expect(config.trustedProviders).toEqual(['google'])
    expect(config.socialProviders.google).toMatchObject({ clientId: 'login-client', clientSecret: 'login-secret' })
    await expect(harness.deps.connectors.findById('login')).rejects.toThrow()
  })
})

it('uses indexed system identifiers and excludes deleted resources [spec: platform-onboarding/system-resource-lookup]', async () => {
  const harness = await createHarness()
  await signInAdmin(harness)
  const prepare = vi.spyOn(env.DB, 'prepare')
  const platform = await findPlatformOrganization(harness.deps)
  const resource = await findRealmrootResourceServer(harness.deps)
  expect(platform?.slug).toBe('realmroot')
  expect(resource?.identifier).toBe('realmroot')
  const queries = prepare.mock.calls.map(([sql]) => sql)
  expect(queries).toHaveLength(2)
  expect(queries[0]).toContain('"organization"."slug" = ?')
  expect(queries[1]).toContain('"api_resource"."identifier" = ?')
  expect(queries.some((sql) => sql.includes('count('))).toBe(false)
  await harness.db.update(apiResource).set({ deletedAt: new Date() }).where(eq(apiResource.id, resource!.id))
  expect(await findRealmrootResourceServer(harness.deps)).toBeNull()
})

it('reads only sign-in settings for provider configuration [spec: connectors-and-methods/authentication-config-loading]', async () => {
  const harness = await createHarness()
  const prepare = vi.spyOn(env.DB, 'prepare')
  await readBuiltInProviderSettings(harness.db)
  expect(prepare).toHaveBeenCalledOnce()
})
