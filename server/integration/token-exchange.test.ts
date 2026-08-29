import { applyD1Migrations, env, reset } from 'cloudflare:test'
import { createAgentWithInstallation } from '@server/usecases/agent-identities'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import { createAccessRequest, createAccessRequestCredential } from '@server/usecases/external-resources'
import type { CreateAgent } from '@shared/api/agent-api'
import { realmrootCliClientId, realmrootOrganizationClaim } from '@shared/oauth-token-profile'
import { decodeJwt, decodeProtectedHeader, exportJWK, generateKeyPair, SignJWT } from 'jose'
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

function base64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function encodeSegment(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

/** Mints an HS256 JWT signed with the trusted issuer's shared secret. */
async function hs256Jwt(secret: string, payload: Record<string, unknown>): Promise<string> {
  const signingInput = `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

/** Generates an ES256 keypair and the matching public JWK (with kid + alg). */
async function es256KeyAndPublicJwk(): Promise<{ privateKey: CryptoKey; publicJwk: Record<string, unknown> }> {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const publicJwk = (await crypto.subtle.exportKey('jwk', publicKey)) as Record<string, unknown>
  publicJwk.kid = 'partner-key-1'
  publicJwk.alg = 'ES256'
  publicJwk.use = 'sig'
  return { privateKey, publicJwk }
}

/** Mints an ES256 JWT signed with the federated credential's private key. */
async function es256Jwt(privateKey: CryptoKey, payload: Record<string, unknown>): Promise<string> {
  const signingInput = `${encodeSegment({ alg: 'ES256', kid: 'partner-key-1', typ: 'JWT' })}.${encodeSegment(payload)}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`
}

async function dpopProof(url: string) {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  return new SignJWT({
    htm: 'POST',
    htu: url,
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk })
    .sign(privateKey)
}

describe('OAuth token exchange over real D1', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
    harness.deps.externalHttp.fetch = resourceOpenApiFetch
  })

  it('exchanges an active Hub Agent lease for a Kubernetes ID token over the real token endpoint [spec: agent-identity/agent-kubernetes-id-token-exchange]', async () => {
    const adminCookie = await signInAdmin(harness)
    const controllerId = await createUser(harness, adminCookie, {
      email: 'kubernetes-controller@example.com',
      username: 'kubernetes-controller',
      displayName: 'Kubernetes Controller',
      password: 'kubernetes-controller-password-2026',
    })
    const membership = await harness.request(`/api/organizations/${platformOrganizationId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ userId: controllerId, roles: ['owner'] }),
    })
    expect(membership.status, await membership.clone().text()).toBe(201)
    const controllerCookie = await signIn(
      harness,
      'kubernetes-controller@example.com',
      'kubernetes-controller-password-2026',
    )
    const now = Date.now()
    await env.DB.prepare('INSERT INTO team (id, name, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('team-kubernetes-operators', 'kubernetes-operators', platformOrganizationId, now, now)
      .run()
    await env.DB.prepare('INSERT INTO team_member (id, team_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind('team-member-kubernetes-controller', 'team-kubernetes-operators', controllerId, now)
      .run()

    const sourceAudience = 'https://hub.example.com'
    const sourceResponse = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        identifier: 'kubernetes-cluster-hub',
        resourceUrl: sourceAudience,
        authorizationModel: 'native',
        ownerOrganizationId: platformOrganizationId,
      }),
    })
    expect(sourceResponse.status, await sourceResponse.clone().text()).toBe(201)
    const source = (await sourceResponse.json()) as { id: string }

    const targetResponse = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Shared Kubernetes',
        slug: 'shared-kubernetes',
        clientType: 'public_native',
        redirectUris: ['com.example.kubernetes:/callback'],
        ownerOrganizationId: platformOrganizationId,
        visibility: 'private',
      }),
    })
    expect(targetResponse.status, await targetResponse.clone().text()).toBe(201)
    const target = (await targetResponse.json()) as { id: string; clientId: string }

    const hubResponse = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: 'Kubernetes Cluster Hub',
        slug: 'kubernetes-cluster-hub',
        clientType: 'machine',
        redirectUris: [],
        ownerOrganizationId: platformOrganizationId,
        tokenExchangePolicies: [{ sourceResourceServerId: source.id, targetApplicationId: target.id }],
      }),
    })
    expect(hubResponse.status, await hubResponse.clone().text()).toBe(201)
    const hub = (await hubResponse.json()) as { clientId: string; clientSecret: string }

    const { publicKey } = await generateKeyPair('Ed25519')
    const publicJwk = {
      ...(await exportJWK(publicKey)),
      kid: 'kubernetes-agent-key',
    } as CreateAgent['installation']['publicKey']
    const agentInput: CreateAgent = {
      username: 'kubernetes-agent',
      name: 'Kubernetes Agent',
      runtime: 'cluster-hub',
      installation: {
        agentId: 'kubernetes-protocol-agent',
        hostId: 'kubernetes-agent-host',
        name: 'Cluster Hub',
        kid: 'kubernetes-agent-key',
        publicKey: publicJwk,
      },
    }
    const createdAgent = await createAgentWithInstallation(harness.deps, agentInput, {
      applicationId: 'kubernetes-cluster-hub',
      actorUserId: controllerId,
      issuer: `${baseURL}/api/auth`,
      idempotencyKey: 'kubernetes-agent',
    })
    const active = await harness.deps.agentIdentities.findActiveBindingByProtocolAgent(agentInput.installation.agentId)
    if (!active) throw new Error('Agent binding was not persisted.')
    const principal = {
      issuer: createdAgent.agent.issuer,
      subject: createdAgent.agent.subject,
      identityId: createdAgent.agent.id,
      protocolAgentId: agentInput.installation.agentId,
      hostId: agentInput.installation.hostId,
      identity: active.identity,
      binding: active.binding,
    }
    const accessRequest = await createAccessRequest(
      harness.deps,
      {
        resourceServerId: source.id,
        scopes: ['resource:read'],
        authorizationDetails: [{ type: 'realmroot_authority', authority: 'organization', id: platformOrganizationId }],
        reason: 'Authenticate to Kubernetes',
      },
      principal,
      baseURL,
    )
    const approval = await harness.request(`/api/account/access-requests/${accessRequest.id}/decision`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: controllerCookie },
      body: JSON.stringify({
        decision: 'approve',
        mode: 'persistent',
        authorizationDetails: [{ type: 'realmroot_authority', authority: 'organization', id: platformOrganizationId }],
      }),
    })
    expect(approval.status, await approval.clone().text()).toBe(200)
    const credentialUrl = `${baseURL}/api/access-requests/${accessRequest.id}/credentials`
    const credential = await createAccessRequestCredential(
      harness.deps,
      accessRequest.id,
      await dpopProof(credentialUrl),
      credentialUrl,
      principal,
      harness.agentTokenSigner,
    )

    const exchange = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${hub.clientId}:${hub.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: credential.accessToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        audience: target.clientId,
        scope: 'openid groups',
      }),
    })
    expect(exchange.status, await exchange.clone().text()).toBe(200)
    const body = (await exchange.json()) as {
      access_token: string
      issued_token_type: string
      refresh_token?: string
    }
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:id_token')
    expect(body.refresh_token).toBeUndefined()
    expect(decodeProtectedHeader(body.access_token)).toMatchObject({ typ: 'JWT' })
    expect(decodeJwt(body.access_token)).toMatchObject({
      sub: controllerId,
      aud: target.clientId,
      azp: hub.clientId,
      act: { iss: `${baseURL}/api/auth`, sub: createdAgent.agent.subject },
      groups: ['kubernetes-operators'],
      [realmrootOrganizationClaim]: platformOrganizationId,
    })
    expect(decodeJwt(body.access_token)).not.toHaveProperty('scope')
    expect(decodeJwt(credential.accessToken)).toMatchObject({ client_id: realmrootCliClientId })
    const audit = await env.DB.prepare(
      "SELECT result, metadata FROM agent_audit_event WHERE action = 'oauth.agent_identity_token_exchanged' ORDER BY occurred_at DESC LIMIT 1",
    ).first<{ result: string; metadata: string }>()
    expect(audit?.result).toBe('allowed')
    expect(JSON.parse(audit?.metadata ?? '{}')).toMatchObject({
      exchangeClientId: hub.clientId,
      targetApplicationId: target.id,
    })
  })

  it('exchanges a configured inbound User Resource token for a narrower downstream token', async () => {
    const cookie = await signInAdmin(harness)
    const delegatedUser = (
      await harness.deps.users.listManagedUsers({ limit: 50, offset: 0, search: 'admin@example.com' })
    ).items[0]
    expect(delegatedUser).toBeDefined()
    const sourceAudience = 'https://ama.example.com'
    const targetAudience = 'https://downstream.example.com'
    const createResource = async (identifier: string, resourceUrl: string) => {
      const response = await harness.request('/api/resource-servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          identifier,
          resourceUrl,
          authorizationModel: 'native',
          ownerOrganizationId: platformOrganizationId,
        }),
      })
      expect(response.status, await response.clone().text()).toBe(201)
      return (await response.json()) as {
        id: string
        scopeRegistry: { scopes: Array<{ value: string; grantMode: string }> } | null
      }
    }
    const source = await createResource('ama-delegation-source', sourceAudience)
    const target = await createResource('delegation-target', targetAudience)
    expect(target.scopeRegistry?.scopes).toContainEqual({
      value: 'resource:read',
      description: null,
      grantMode: 'assigned',
    })
    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Delegating Resource Server',
        slug: 'delegating-resource-server',
        clientType: 'confidential_web',
        redirectUris: ['https://ama.example.com/auth/callback'],
        ownerOrganizationId: platformOrganizationId,
        tokenExchangePolicies: [
          {
            sourceResourceServerId: source.id,
            targetResourceServerId: target.id,
            scopeMappings: [{ sourceScope: 'resource:read', targetScope: 'resource:read' }],
          },
        ],
        resourceScopes: [{ resourceServerId: target.id, scopes: ['resource:read'] }],
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as {
      id: string
      clientId: string
      clientSecret: string
      resourceScopes: Array<{ resourceServerId: string; scopes: string[] }>
      tokenExchangePolicies: Array<{
        sourceResourceServerId: string
        targetResourceServerId: string
        scopeMappings: Array<{ sourceScope: string; targetScope: string }>
      }>
      allowedGrantTypes: string[]
    }
    expect(application.allowedGrantTypes).toEqual([
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ])
    expect(application.resourceScopes).toEqual([{ resourceServerId: target.id, scopes: ['resource:read'] }])
    expect(application.tokenExchangePolicies).toEqual([
      {
        sourceResourceServerId: source.id,
        targetResourceServerId: target.id,
        scopeMappings: [{ sourceScope: 'resource:read', targetScope: 'resource:read' }],
      },
    ])
    const permission = await harness.request(`/api/applications/${application.id}/permissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        organizationId: platformOrganizationId,
        resourceServerId: target.id,
        scope: 'resource:read',
        mode: 'persistent',
      }),
    })
    expect(permission.status, await permission.clone().text()).toBe(201)
    const userPermission = await harness.request(`/api/users/${delegatedUser!.id}/permissions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        organizationId: platformOrganizationId,
        resourceServerId: target.id,
        scope: 'resource:read',
        mode: 'persistent',
      }),
    })
    expect(userPermission.status, await userPermission.clone().text()).toBe(201)
    const now = Math.floor(Date.now() / 1000)
    const subjectToken = await harness.agentTokenSigner.sign(
      {
        iss: `${baseURL}/api/auth`,
        sub: delegatedUser!.id,
        aud: sourceAudience,
        client_id: application.clientId,
        scope: 'resource:read',
        [realmrootOrganizationClaim]: platformOrganizationId,
        iat: now,
        exp: now + 600,
      },
      'at+jwt',
    )
    const exchange = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`,
        origin: baseURL,
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        audience: targetAudience,
        scope: 'resource:read',
      }).toString(),
    })
    expect(exchange.status, await exchange.clone().text()).toBe(200)
    const body = (await exchange.json()) as { access_token: string; refresh_token?: string }
    expect(body.refresh_token).toBeUndefined()
    expect(decodeJwt(body.access_token)).toMatchObject({
      sub: delegatedUser!.id,
      aud: targetAudience,
      client_id: application.clientId,
      scope: 'resource:read',
    })
    expect(decodeJwt(body.access_token)).not.toHaveProperty('act')
  })

  it('exchanges an ES256 subject token via a federated credential, then introspects it (real SQL)', async () => {
    const cookie = await signInAdmin(harness)
    const audience = 'https://api.example.com'

    // Confidential client allowed to use the token-exchange grant (findClient path).
    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Exchange Client',
        slug: 'exchange-client',
        clientType: 'machine',
        redirectUris: [],
        ownerOrganizationId: platformOrganizationId,
      }),
    })
    expect(createApp.status, await createApp.clone().text()).toBe(201)
    const application = (await createApp.json()) as { id: string; clientId: string; clientSecret: string }

    // The API resource that defines the minted token's audience.
    const createResource = await harness.request('/api/resource-servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        identifier: audience,
        resourceUrl: audience,
        authorizationModel: 'native',
        ownerOrganizationId: platformOrganizationId,
      }),
    })
    expect(createResource.status, await createResource.clone().text()).toBe(201)
    const resource = (await createResource.json()) as { id: string }
    const configureApplication = await harness.request(`/api/applications/${application.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        resourceScopes: [{ resourceServerId: resource.id, scopes: ['resource:read'] }],
      }),
    })
    expect(configureApplication.status, await configureApplication.clone().text()).toBe(200)

    // Federated credential under the application (asymmetric, inline public JWK).
    const issuerUrl = 'https://issuer.partner.example.com'
    const { privateKey, publicJwk } = await es256KeyAndPublicJwk()
    const createCredential = await harness.request(`/api/applications/${application.id}/federated-credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Partner',
        issuer: issuerUrl,
        subject: 'partner-user-1',
        audienceResourceId: resource.id,
        publicKeys: [publicJwk],
      }),
    })
    expect(createCredential.status, await createCredential.clone().text()).toBe(201)
    const { credential } = (await createCredential.json()) as { credential: { id: string } }

    const now = Math.floor(Date.now() / 1000)
    const subjectToken = await es256Jwt(privateKey, {
      iss: issuerUrl,
      sub: 'partner-user-1',
      aud: audience,
      exp: now + 300,
      iat: now,
      email: 'partner-user@example.com',
    })

    const basic = `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`
    const exchange = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience,
        scope: 'resource:read offline_access',
      }).toString(),
    })
    expect(exchange.status, await exchange.clone().text()).toBe(200)
    const exchanged = (await exchange.json()) as { access_token: string; refresh_token: string; token_type: string }
    expect(exchanged.token_type).toBe('Bearer')
    expect(decodeProtectedHeader(exchanged.access_token).typ).toBe('at+jwt')
    expect(decodeJwt(exchanged.access_token)).toMatchObject({
      sub: 'partner-user-1',
      aud: audience,
      client_id: application.clientId,
      [realmrootOrganizationClaim]: platformOrganizationId,
    })

    // Introspection reads the stored token by hash (storeAccessToken + findAccessTokenByHash).
    const introspect = await harness.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({ token: exchanged.access_token }).toString(),
    })
    expect(introspect.status, await introspect.clone().text()).toBe(200)
    const introspection = (await introspect.json()) as { active: boolean; sub?: string; aud?: string; act?: unknown }
    expect(introspection.active).toBe(true)
    expect(introspection.sub).toBe('partner-user-1')
    expect(introspection.aud).toBe(audience)
    expect(introspection.act).toBeUndefined()

    const refresh = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: exchanged.refresh_token }).toString(),
    })
    expect(refresh.status, await refresh.clone().text()).toBe(200)
    const refreshed = (await refresh.json()) as { access_token: string; refresh_token: string }
    expect(decodeProtectedHeader(refreshed.access_token).typ).toBe('at+jwt')
    expect(decodeJwt(refreshed.access_token)).toMatchObject({
      sub: 'partner-user-1',
      client_id: application.clientId,
      aud: audience,
    })
    expect(refreshed.refresh_token).toMatch(/^fatr_/)
    expect(refreshed.refresh_token).not.toBe(exchanged.refresh_token)

    const legacyToken = 'fatx_legacy-d1-token'
    await env.DB.prepare(
      `INSERT INTO token_exchange_access_token
       (id, token_hash, client_id, credential_id, subject, subject_token_issuer, audience, scopes, claims, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        'legacy-access-token',
        await hashProviderSecret(legacyToken),
        application.clientId,
        credential.id,
        'partner-user-1',
        issuerUrl,
        audience,
        JSON.stringify(['resource:read']),
        JSON.stringify({ legacy: true }),
        Date.now() + 60_000,
        Date.now(),
      )
      .run()
    const legacyIntrospection = await harness.request('/api/auth/oauth2/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basic },
      body: new URLSearchParams({ token: legacyToken }),
    })
    expect(legacyIntrospection.status, await legacyIntrospection.clone().text()).toBe(200)
    expect(await legacyIntrospection.json()).toMatchObject({
      active: true,
      sub: 'partner-user-1',
      client_id: application.clientId,
    })
  })

  it('rejects an untrusted issuer subject token', async () => {
    const cookie = await signInAdmin(harness)
    const audience = 'https://api.example.com'

    const createApp = await harness.request('/api/applications', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Exchange Client 2',
        slug: 'exchange-client-2',
        clientType: 'machine',
        redirectUris: [],
        ownerOrganizationId: platformOrganizationId,
      }),
    })
    const application = (await createApp.json()) as { clientId: string; clientSecret: string }

    const now = Math.floor(Date.now() / 1000)
    const subjectToken = await hs256Jwt('whatever-secret-1234567890', {
      iss: 'https://unknown.example.com',
      sub: 'x',
      aud: audience,
      exp: now + 300,
      iat: now,
    })

    const basic = `Basic ${btoa(`${application.clientId}:${application.clientSecret}`)}`
    const exchange = await harness.request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic,
        origin: 'http://localhost',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        audience,
      }).toString(),
    })
    expect(exchange.status).toBe(400)
    await expect(exchange.json()).resolves.toMatchObject({ error: 'invalid_grant' })
  })
})
