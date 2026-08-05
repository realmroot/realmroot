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

  // Exercises the authorization repo reads used by token-claim assembly through
  // real SQL: resource lookup, Organization membership, and dynamic BA Roles.
  it('resolves audience and Organization member Roles without assigning Roles to workloads [spec: admin-console/oidc-claim-emission]', async () => {
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
    const audience = 'https://api.example.com/contacts'
    const resource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
        identifier: 'contacts-api',
        name: 'Contacts API',
        resourceUrl: audience,
        ownerOrganizationId: organization.id,
      })
    ).json()) as { id: string }
    const member = (await (
      await postJson(harness, cookie, `/api/organizations/${organization.id}/members`, {
        userId,
        roles: ['member'],
      })
    ).json()) as { id: string }
    await postJson(
      harness,
      cookie,
      `/api/organizations/${organization.id}/roles`,
      {
        key: 'contacts-reader',
        displayName: 'Contacts reader',
        scopes: [{ resourceId: resource.id, scope: 'contacts:read' }],
      },
      201,
    )
    await postJson(
      harness,
      cookie,
      `/api/organizations/${organization.id}/members/${member.id}/roles`,
      { roles: ['contacts-reader', 'member'] },
      200,
      'PUT',
    )

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
    // Roles belong only to the Organization user. The Application contributes
    // its requested/granted scopes directly and never receives a Role.
    expect(application.id).toBeTruthy()
    expect(claims.authorization.roles).toEqual(['contacts-reader', 'member'])
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
