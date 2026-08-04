import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { buildTokenClaims } from '@server/usecases/authorization'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, createUser, type Harness, resourceOpenApiFetch, signInAdmin } from './harness'

afterEach(async () => {
  await reset()
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})

async function postJson(
  harness: Harness,
  cookie: string,
  path: string,
  body: unknown,
  expected = 201,
  method = 'POST',
) {
  const res = await harness.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
  expect(res.status, await res.clone().text()).toBe(expected)
  return res
}

describe('OAuth token claim building over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
  })

  // Exercises the authorization repo read paths that only fire during token-claim
  // assembly — findResourceByResourceUrl plus contextual user and workload
  // assignment reads — through real SQL (the usecase tests cover the
  // branching logic with fake ports; this proves the real queries).
  it('resolves audience + user/application/member role assignments [spec: admin-console/oidc-claim-emission]', async () => {
    harness.deps.externalHttp.fetch = async (request) => {
      if (new URL(request.url).pathname.endsWith('/openapi.json')) {
        return Response.json({
          openapi: '3.1.0',
          components: {
            securitySchemes: {
              oauth: {
                type: 'oauth2',
                flows: {
                  authorizationCode: {
                    authorizationUrl: '/authorize',
                    tokenUrl: '/token',
                    scopes: { 'contacts:read': 'Read contacts' },
                  },
                },
              },
            },
          },
          paths: { '/contacts': { get: { security: [{ oauth: ['contacts:read'] }] } } },
        })
      }
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    const cookie = await signInAdmin(harness)
    const userId = await createUser(harness, cookie, {
      email: 'claims-user@example.com',
      username: 'claimsuser',
      displayName: 'Claims User',
      password: 'claims-user-password-2026',
    })

    const audience = 'https://api.example.com/contacts'
    const resource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
        identifier: 'contacts-api',
        name: 'Contacts API',
        resourceUrl: audience,
      })
    ).json()) as { id: string }
    const application = (await (
      await postJson(harness, cookie, '/api/applications', {
        name: 'Claims App',
        clientType: 'public_spa',
        redirectUris: ['https://app.example.com/callback'],
      })
    ).json()) as { id: string }

    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'claims-org', name: 'Claims Org' })
    ).json()) as { id: string }
    expect(
      (
        await postJson(harness, cookie, `/api/organizations/${organization.id}/members`, {
          userId,
          role: 'member',
        })
      ).status,
    ).toBe(201)

    // Distinct roles per subject so each assignment read is independently proven.
    const roleId = async (key: string, name: string) =>
      (
        (await (await postJson(harness, cookie, '/api/access/roles', { key, name })).json()) as {
          id: string
        }
      ).id
    const userRole = await roleId('contacts-user-role', 'Contacts User')
    const appRole = await roleId('contacts-app-role', 'Contacts App')
    const memberRole = await roleId('contacts-member-role', 'Contacts Member')

    for (const roleId of [userRole, appRole, memberRole]) {
      const current = await harness.request(`/api/access/roles/${roleId}/scopes`, { headers: { cookie } })
      const etag = current.headers.get('etag')
      expect(etag).toBeTruthy()
      const replaced = await harness.request(`/api/access/roles/${roleId}/scopes`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie, 'if-match': etag! },
        body: JSON.stringify({ scopes: [{ resourceId: resource.id, scope: 'contacts:read' }] }),
      })
      expect(replaced.status, await replaced.clone().text()).toBe(200)
    }
    await postJson(harness, cookie, '/api/access/assignments', {
      roleId: userRole,
      subjectType: 'user',
      subjectId: userId,
    })
    await postJson(harness, cookie, '/api/access/assignments', {
      roleId: appRole,
      subjectType: 'workload',
      subjectId: application.id,
    })
    await postJson(harness, cookie, '/api/access/assignments', {
      roleId: memberRole,
      subjectType: 'user',
      subjectId: userId,
      organizationId: organization.id,
    })

    const claims = (await buildTokenClaims(harness.deps, {
      userId,
      applicationId: application.id,
      organizationId: organization.id,
      resource: audience,
      scopes: ['openid', 'contacts:read'],
      destination: 'access_token',
    })) as {
      authorization: { audience: string; resource: string; organization_id: string; roles: string[]; scopes: string[] }
    }

    // findResourceByResourceUrl returned the registered resource.
    expect(claims.authorization.audience).toBe(audience)
    expect(claims.authorization.resource).toBe('contacts-api')
    expect(claims.authorization.organization_id).toBe(organization.id)
    // Each role surfaced through its own real-SQL assignment read.
    expect(claims.authorization.roles).toEqual(
      expect.arrayContaining(['contacts-user-role', 'contacts-app-role', 'contacts-member-role']),
    )
    expect(claims.authorization.scopes).toEqual(['contacts:read'])
  })

  it('returns audience-free claims when the resource is unregistered [spec: admin-console/admin-application-oidc-claims]', async () => {
    await signInAdmin(harness)
    const claims = (await buildTokenClaims(harness.deps, {
      userId: 'nobody',
      resource: 'https://unregistered.example.com',
      scopes: ['openid'],
      destination: 'access_token',
    })) as { authorization?: { audience?: string } }
    // findResourceByResourceUrl ran (real SQL) and found nothing → no audience claim.
    expect(claims.authorization?.audience).toBeUndefined()
  })
})
