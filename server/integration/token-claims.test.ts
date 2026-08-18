import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { filterOAuthAccessTokenScopes } from '@server/auth'
import { buildTokenClaims, ensureRealmrootResourceServer } from '@server/usecases/authorization'
import { realmrootTenantClaim } from '@shared/oauth-token-profile'
import { calculateJwkThumbprint, decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  baseURL,
  createHarness,
  createUser,
  type Harness,
  platformOrganizationId,
  resourceOpenApiFetch,
  signIn,
  signInAdmin,
} from './harness'

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
      if (request.url.includes('/.well-known/oauth-protected-resource')) {
        return Response.json({ resource: audience, scopes_supported: ['contacts:read'] })
      }
      if (new URL(request.url).pathname.endsWith('/openapi.json')) {
        return Response.json({
          openapi: '3.1.0',
          info: { title: 'Contacts API', version: '1.0.0' },
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
        clientType: 'confidential_web',
        redirectUris: ['https://app.example.com/callback'],
        ownerOrganizationId: platformOrganizationId,
        consentRequired: false,
      })
    ).json()) as { id: string; clientId: string; clientSecret: string }

    const organization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'claims-org', name: 'Claims Org' })
    ).json()) as { id: string }
    const audience = 'https://api.example.com/contacts'
    const resource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
        identifier: 'contacts-api',
        resourceUrl: audience,
        authorizationModel: 'native',
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
    const tenantApplication = (await (
      await postJson(harness, cookie, '/api/applications', {
        name: 'Tenant Claims App',
        clientType: 'confidential_web',
        redirectUris: ['https://tenant-app.example.com/callback'],
        ownerOrganizationId: organization.id,
        resourceScopes: [{ resourceServerId: resource.id, scopes: ['contacts:read'] }],
      })
    ).json()) as { id: string }
    const foreignOrganization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'foreign-active-org', name: 'Foreign Active Org' })
    ).json()) as { id: string }
    await postJson(harness, cookie, `/api/organizations/${foreignOrganization.id}/members`, {
      userId,
      roles: ['member'],
    })
    await expect(
      filterOAuthAccessTokenScopes(harness.deps, {
        user: { id: userId },
        scopes: ['openid', 'contacts:read'],
        resource: audience,
        referenceId: foreignOrganization.id,
        metadata: { applicationId: tenantApplication.id },
      }),
    ).rejects.toMatchObject({ body: { error: 'invalid_target' } })
    await expect(
      filterOAuthAccessTokenScopes(harness.deps, {
        user: { id: userId },
        scopes: ['openid', 'contacts:read'],
        resource: audience,
        referenceId: organization.id,
        metadata: { applicationId: tenantApplication.id },
      }),
    ).resolves.toEqual(['openid'])

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

    harness.deps.externalHttp.fetch = async (request) => {
      if (request.url.includes('/.well-known/oauth-protected-resource')) {
        return Response.json({ resource: audience, scopes_supported: ['contacts:other'] })
      }
      if (new URL(request.url).pathname.endsWith('/openapi.json')) {
        return Response.json({
          openapi: '3.1.0',
          info: { title: 'Contacts API', version: '1.0.0' },
          components: { securitySchemes: {} },
          paths: {},
        })
      }
      return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
    }
    const refresh = await harness.request(`/api/resource-servers/${resource.id}/scope-registry`, {
      method: 'PUT',
      headers: { cookie },
    })
    expect(refresh.status, await refresh.clone().text()).toBe(200)

    const claimsAfterScopeRemoval = (await buildTokenClaims(harness.deps, {
      userId,
      applicationId: application.id,
      organizationId: organization.id,
      resource: audience,
      scopes: ['openid', 'contacts:read'],
      destination: 'access_token',
    })) as { authorization: { scopes: string[] } }
    expect(claimsAfterScopeRemoval.authorization.scopes).toEqual([])

    await env.DB.prepare('UPDATE oauth_client SET scopes = ? WHERE client_id = ?')
      .bind(JSON.stringify(['openid', 'contacts:read']), application.clientId)
      .run()

    harness = await createHarness({ validAudiences: [baseURL, audience] })
    harness.deps.externalHttp.fetch = removedScopeOpenApiFetch
    let memberCookie = await signIn(harness, 'claims-user@example.com', 'claims-user-password-2026')
    const activeOrganization = await harness.request('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: memberCookie, origin: baseURL },
      body: JSON.stringify({ organizationId: organization.id }),
    })
    expect(activeOrganization.status, await activeOrganization.clone().text()).toBe(200)
    memberCookie = mergeResponseCookies(memberCookie, activeOrganization)

    const verifier = 'scope-removal-pkce-verifier-0123456789abcdefghijklmnop'
    const authorize = await harness.request(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: application.clientId,
        redirect_uri: 'https://app.example.com/callback',
        scope: 'openid',
        resource: audience,
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
      })}`,
      { headers: { cookie: memberCookie }, redirect: 'manual' },
    )
    expect(authorize.status, await authorize.clone().text()).toBe(302)
    const code = new URL(authorize.headers.get('location') ?? '').searchParams.get('code')
    expect(code).toBeTruthy()

    const token = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${encodeURIComponent(application.clientId)}:${encodeURIComponent(application.clientSecret)}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: 'https://app.example.com/callback',
        code: code ?? '',
        code_verifier: verifier,
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const tokenBody = (await token.json()) as { access_token: string; id_token: string; scope: string }
    expect(tokenBody.scope).toBe('openid')
    expect(decodeProtectedHeader(tokenBody.access_token).typ).toBe('at+jwt')
    expect(decodeProtectedHeader(tokenBody.id_token).typ).not.toBe('at+jwt')
    const accessPayload = decodeJwtPayload(tokenBody.access_token)
    expect(accessPayload).toMatchObject({
      scope: 'openid',
      client_id: application.clientId,
      roles: ['contacts-reader', 'member'],
      groups: [organization.id],
      [realmrootTenantClaim]: { type: 'organization', id: organization.id },
    })
    expect(accessPayload).not.toHaveProperty('authorization')
    expect(accessPayload).not.toHaveProperty('azp')
    expect(accessPayload).not.toHaveProperty('application_id')
    expect(accessPayload).not.toHaveProperty('organization_id')

    const introspection = await harness.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: tokenBody.access_token,
        client_id: application.clientId,
        client_secret: application.clientSecret,
      }),
    })
    expect(introspection.status, await introspection.clone().text()).toBe(200)
    expect(await introspection.json()).toMatchObject({ active: true, scope: 'openid' })
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

  it('attenuates client credentials scopes at the Application owner Organization boundary [spec: admin-console/oidc-claim-emission]', async () => {
    harness.deps.externalHttp.fetch = contactsScopeOpenApiFetch
    const cookie = await signInAdmin(harness)
    const ownerOrganization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'workload-owner', name: 'Workload Owner' })
    ).json()) as { id: string }
    const foreignOrganization = (await (
      await postJson(harness, cookie, '/api/organizations', { slug: 'foreign-resource', name: 'Foreign Resource' })
    ).json()) as { id: string }
    const audience = 'https://api.example.com/foreign-contacts'
    const ownerAudience = 'https://api.example.com/owner-contacts'
    await postJson(harness, cookie, '/api/resource-servers', {
      identifier: 'foreign-contacts-api',
      resourceUrl: audience,
      authorizationModel: 'native',
      ownerOrganizationId: foreignOrganization.id,
      visibility: 'private',
    })
    const ownerResource = (await (
      await postJson(harness, cookie, '/api/resource-servers', {
        identifier: 'owner-contacts-api',
        resourceUrl: ownerAudience,
        authorizationModel: 'native',
        ownerOrganizationId: ownerOrganization.id,
        visibility: 'private',
      })
    ).json()) as { id: string }
    await postJson(
      harness,
      cookie,
      `/api/resource-servers/${ownerResource.id}`,
      { scopeGrantModes: [{ scope: 'contacts:read', grantMode: 'automatic' }] },
      200,
      'PATCH',
    )
    const application = (await (
      await postJson(harness, cookie, '/api/applications', {
        name: 'Workload Client',
        clientType: 'machine',
        redirectUris: [],
        ownerOrganizationId: ownerOrganization.id,
        resourceScopes: [{ resourceServerId: ownerResource.id, scopes: ['contacts:read'] }],
      })
    ).json()) as { id: string; clientId: string; clientSecret: string }

    harness = await createHarness({ validAudiences: [baseURL, audience, ownerAudience] })
    harness.deps.externalHttp.fetch = contactsScopeOpenApiFetch
    const ownerToken = await issueClientCredentials(harness, application, ownerAudience)
    expect(ownerToken.scope).toBe('contacts:read')
    const ownerPayload = decodeJwtPayload(ownerToken.access_token)
    expect(ownerPayload).toMatchObject({
      scope: 'contacts:read',
      sub: application.id,
      client_id: application.clientId,
      [realmrootTenantClaim]: { type: 'organization', id: ownerOrganization.id },
    })
    expect(ownerPayload).not.toHaveProperty('authorization')

    const token = await clientCredentialsResponse(harness, application, audience)
    expect(token.status).toBe(400)
    await expect(token.json()).resolves.toMatchObject({ error: 'invalid_target' })
  })

  it('issues a signed DPoP-bound Realmroot resource token to a machine Application', async () => {
    const cookie = await signInAdmin(harness)
    const realmrootResource = await ensureRealmrootResourceServer(harness.deps, baseURL)
    const application = (await (
      await postJson(harness, cookie, '/api/applications', {
        name: 'Realmroot Automation',
        clientType: 'machine',
        redirectUris: [],
        ownerOrganizationId: platformOrganizationId,
        resourceScopes: [{ resourceServerId: realmrootResource.id, scopes: ['applications:read'] }],
      })
    ).json()) as { id: string; clientId: string; clientSecret: string }
    const admin = await env.DB.prepare("SELECT id FROM user WHERE email = 'admin@example.com'").first<{ id: string }>()
    expect(admin?.id).toBeTruthy()
    await env.DB.prepare(
      `INSERT INTO resource_scope_entitlement
       (id, application_id, resource_server_id, authorization_context_hash, scope, mode, granted_by_user_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'persistent', ?, ?, ?)`,
    )
      .bind(
        'application-realmroot-read',
        application.id,
        realmrootResource.id,
        'none',
        'applications:read',
        admin!.id,
        Date.now(),
        Date.now(),
      )
      .run()

    const keys = await generateKeyPair('ES256', { extractable: true })
    const publicJwk = await exportJWK(keys.publicKey)
    const tokenEndpoint = `${baseURL}/api/auth/oauth2/token`
    const proof = await new SignJWT({ htm: 'POST', htu: tokenEndpoint })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicJwk })
      .setIssuedAt()
      .setJti(crypto.randomUUID())
      .sign(keys.privateKey)
    const token = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`,
        dpop: proof,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        resource: `${baseURL}/api`,
        scope: 'applications:read',
      }),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    const body = (await token.json()) as { access_token: string; token_type: string }
    expect(body.token_type).toBe('DPoP')
    expect(decodeProtectedHeader(body.access_token).typ).toBe('at+jwt')
    expect(decodeJwtPayload(body.access_token)).toMatchObject({
      sub: application.id,
      client_id: application.clientId,
      aud: `${baseURL}/api`,
      scope: 'applications:read',
      cnf: { jkt: await calculateJwkThumbprint(publicJwk) },
      [realmrootTenantClaim]: { type: 'organization', id: platformOrganizationId },
    })
  })
})

async function removedScopeOpenApiFetch(request: Request) {
  if (request.url.includes('/.well-known/oauth-protected-resource')) {
    return Response.json({ resource: resourceUrlFromMetadataUrl(request.url), scopes_supported: ['contacts:other'] })
  }
  if (new URL(request.url).pathname.endsWith('/openapi.json')) {
    return Response.json({
      openapi: '3.1.0',
      info: { title: 'Contacts API', version: '1.0.0' },
      components: { securitySchemes: {} },
      paths: {},
    })
  }
  return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
}

async function contactsScopeOpenApiFetch(request: Request) {
  if (request.url.includes('/.well-known/oauth-protected-resource')) {
    return Response.json({ resource: resourceUrlFromMetadataUrl(request.url), scopes_supported: ['contacts:read'] })
  }
  if (new URL(request.url).pathname.endsWith('/openapi.json')) {
    return Response.json({
      openapi: '3.1.0',
      info: { title: 'Contacts API', version: '1.0.0' },
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              clientCredentials: { tokenUrl: '/token', scopes: { 'contacts:read': 'Read contacts' } },
            },
          },
        },
      },
      paths: { '/contacts': { get: { security: [{ oauth: ['contacts:read'] }] } } },
    })
  }
  return new Response(null, { headers: { link: '</openapi.json>; rel="service-desc"' } })
}

function resourceUrlFromMetadataUrl(metadataUrl: string) {
  const metadata = new URL(metadataUrl)
  const prefix = '/.well-known/oauth-protected-resource'
  return `${metadata.origin}${metadata.pathname.slice(prefix.length)}${metadata.search}`
}

async function issueClientCredentials(
  harness: Harness,
  application: { clientId: string; clientSecret: string },
  resource: string,
) {
  const response = await clientCredentialsResponse(harness, application, resource)
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as { access_token: string; scope: string }
}

function clientCredentialsResponse(
  harness: Harness,
  application: { clientId: string; clientSecret: string },
  resource: string,
) {
  return harness.request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: application.clientId,
      client_secret: application.clientSecret,
      scope: 'contacts:read',
      resource,
    }),
  })
}

function mergeResponseCookies(currentCookie: string, response: Response) {
  const values = new Map(currentCookie.split('; ').map((pair) => pair.split('=', 2) as [string, string]))
  for (const part of (response.headers.get('set-cookie') ?? '').split(',')) {
    const pair = part.trim().split(';')[0]
    const separator = pair.indexOf('=')
    if (separator > 0) values.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join('; ')
}

async function pkceChallenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  let value = ''
  for (const byte of digest) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? ''
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')
  return JSON.parse(atob(padded.replaceAll('-', '+').replaceAll('_', '/'))) as Record<string, unknown>
}
