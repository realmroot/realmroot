import { createApp } from '@server/http/app'
import { unifiedOpenApi } from '@server/http/openapi/management'
import { protectedResourceCollectionRoutes } from '@shared/api/management'
import { realmrootOAuthScopes, requiredProtectedScope } from '@shared/authz'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'
import {
  assertConstrainedOpenApiSchema,
  createAuthMock,
  createSecurityRepositoryMock,
  createUserRepositoryMock,
  managementOpenApiOperationKey,
  methodsWithJsonRequestBody,
  mountedManagementOperations,
  openApiOperationObjects,
  openApiOperations,
  openApiRecord,
  openApiSchemaObject,
  operationsWithoutRequestBody,
  requestBodyContent,
  schemaReference,
  securityPolicy,
  userHeaders,
} from './management.test-utils'

describe('management routes 1', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  it('keeps the unified OpenAPI route inventory aligned with mounted routes', () => {
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security: createSecurityRepositoryMock(),
      }),
      { securityPolicy: securityPolicy() },
    )

    expect(openApiOperations()).toEqual(mountedManagementOperations(app))

    const operationIds = openApiOperationObjects().map((operation) => operation.operationId)
    expect(operationIds).not.toContain(undefined)
    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(unifiedOpenApi.security).toBeUndefined()
    expect(unifiedOpenApi.components.securitySchemes.dpop).toMatchObject({
      type: 'http',
      scheme: 'DPoP',
    })
    expect(unifiedOpenApi.components.securitySchemes.sessionCookie).toMatchObject({ type: 'apiKey', in: 'cookie' })
    expect(unifiedOpenApi.components.securitySchemes).not.toHaveProperty('agentAuth')
    expect(unifiedOpenApi['x-cli-config']).toEqual({
      command_layout: 'tags',
      profiles: {
        default: {
          credentials: {
            dpop: {
              auth: {
                type: 'bearer',
                params: {
                  token: 'realmroot-plugin-managed',
                  provider: 'realmroot-agent',
                },
              },
              satisfies: realmrootOAuthScopes,
            },
          },
        },
      },
    })

    for (const operation of openApiOperationObjects()) {
      if (operation.key === managementOpenApiOperationKey) {
        expect(operation.security).toEqual([])
        continue
      }

      if (operation.key !== 'GET /assets/{param}') {
        expect(operation.responses, operation.key).toHaveProperty('401')
        expect(operation.responses, operation.key).toHaveProperty('403')
      }
      expect(operation.declaredPathParameters, operation.key).toEqual(operation.pathParameters)
      const requiredScope = requiredProtectedScope(operation.method, operation.key.slice(operation.method.length + 1))
      if (requiredScope && JSON.stringify(operation.security).includes('sessionCookie')) {
        expect(operation.security, operation.key).toEqual([
          { dpop: [requiredScope] },
          { sessionCookie: [requiredScope] },
        ])
      }

      if (methodsWithJsonRequestBody.has(operation.method) && !operationsWithoutRequestBody.has(operation.key)) {
        expect(requestBodyContent(operation.requestBody), operation.key).toEqual(
          expect.objectContaining({
            schema: expect.any(Object),
          }),
        )
        expect(schemaReference(requestBodyContent(operation.requestBody).schema), operation.key).not.toBe(
          '#/components/schemas/GenericObject',
        )
        expect(() =>
          assertConstrainedOpenApiSchema(requestBodyContent(operation.requestBody).schema, operation.key),
        ).not.toThrow()
      }

      for (const schema of operation.jsonResponseSchemas) {
        expect(schema, operation.key).toEqual(expect.any(Object))
        expect(schemaReference(schema), operation.key).not.toBe('#/components/schemas/GenericObject')
        expect(() => assertConstrainedOpenApiSchema(schema, operation.key)).not.toThrow()
      }
    }
  })

  it('serves the unified OpenAPI contract with Restish discovery headers [spec: management-api/management-openapi-discovery]', async () => {
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security: createSecurityRepositoryMock(),
      }),
      { securityPolicy: securityPolicy() },
    )

    const contract = await app.request('/api/openapi.json')
    const documentation = await app.request('/api/docs')
    const protectedResponse = await app.request('/api/users')

    expect(contract.status).toBe(200)
    expect(contract.headers.get('content-type')).toContain('application/json')
    expect(contract.headers.get('link')).toBeNull()
    await expect(contract.json()).resolves.toEqual(unifiedOpenApi)
    expect(documentation.status).toBe(200)
    expect(documentation.headers.get('content-type')).toContain('text/html')
    const documentationHtml = await documentation.text()
    expect(documentationHtml).toContain('<title>Realmroot API Documentation</title>')
    expect(documentationHtml).toContain('/api/openapi.json')
    expect(documentationHtml).toContain('@scalar/api-reference@1.64.0')

    const declaredTags = new Set(
      ((unifiedOpenApi as { tags?: Array<{ name: string }> }).tags ?? []).map((tag) => tag.name),
    )
    expect(declaredTags.size).toBeGreaterThan(1)
    for (const operation of openApiOperationObjects()) {
      expect(operation.tags, operation.key).toHaveLength(1)
      expect(declaredTags.has(operation.tags?.[0] ?? ''), operation.key).toBe(true)
    }

    const accessRequest = openApiOperationObjects().find((operation) => operation.key === 'POST /access/requests')
    const standaloneRequestSchema = requestBodyContent(accessRequest?.requestBody).schema
    expect(JSON.stringify(standaloneRequestSchema)).not.toContain('#/components/')

    expect(protectedResponse.status).toBe(401)
    expect(protectedResponse.headers.get('link')).toContain('</api/openapi.json>; rel="service-desc"')
  })

  it('limits generated Restish commands to discovery, approval, and credential workflows [spec: management-api/management-restish-command-surface]', () => {
    const generatedCommands = openApiOperationObjects()
      .filter((operation) => operation.cliHidden !== true)
      .map((operation) => ({
        group: operation.tags?.[0],
        name: operation.cliName,
        operationId: operation.operationId,
      }))

    expect(generatedCommands).toEqual([
      { group: 'auth', name: 'whoami', operationId: 'getAgentStatus' },
      { group: 'Resource Servers', name: 'connect', operationId: 'createConnectionRequest' },
      { group: 'Agent Access', name: 'access', operationId: 'createAgentAuthorizationRequest' },
    ])
  })

  it('documents application setup fields and Organization Role request bodies', () => {
    const createApplication = openApiOperationObjects().find((operation) => operation.key === 'POST /applications')
    const createApplicationSchema = openApiSchemaObject(requestBodyContent(createApplication?.requestBody).schema)
    const createApplicationProperties = openApiRecord(createApplicationSchema.properties)

    expect(createApplicationProperties).toHaveProperty('postLogoutRedirectUris')
    expect(createApplicationProperties).toHaveProperty('corsOrigins')
    expect(createApplicationProperties).not.toHaveProperty('clientId')
    expect(createApplicationProperties).not.toHaveProperty('clientSecret')

    const createRole = openApiOperationObjects().find(
      (operation) => operation.key === 'POST /organizations/{param}/roles',
    )
    const createRoleSchema = openApiSchemaObject(requestBodyContent(createRole?.requestBody).schema)
    const createRoleProperties = openApiRecord(createRoleSchema.properties)

    expect(createRoleProperties).toHaveProperty('key')
    expect(createRoleProperties).toHaveProperty('scopes')
    expect(createRole?.responses).toHaveProperty('201')

    const replaceMemberRoles = openApiOperationObjects().find(
      (operation) => operation.key === 'PUT /organizations/{param}/members/{param}/roles',
    )
    const replaceMemberRolesSchema = openApiSchemaObject(requestBodyContent(replaceMemberRoles?.requestBody).schema)
    expect(openApiRecord(replaceMemberRolesSchema.properties)).toHaveProperty('roles')
    expect(replaceMemberRoles?.responses).toHaveProperty('200')

    const deleteApiResource = openApiOperationObjects().find(
      (operation) => operation.key === 'DELETE /resource-servers/{param}',
    )
    expect(deleteApiResource?.responses).toHaveProperty('204')
    expect(deleteApiResource?.responses).toHaveProperty('409')

    const archiveApiResource = openApiOperationObjects().find(
      (operation) => operation.key === 'PUT /resource-servers/{param}/archival',
    )
    const restoreApiResource = openApiOperationObjects().find(
      (operation) => operation.key === 'DELETE /resource-servers/{param}/archival',
    )
    expect(archiveApiResource?.responses).toHaveProperty('200')
    expect(restoreApiResource?.responses).toHaveProperty('200')
  })

  it('mounts the documented management collections behind the admin boundary', async () => {
    const app = createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() }))

    for (const route of protectedResourceCollectionRoutes) {
      const response = await app.request(`/api${route}`)
      expect(response.status, route).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'unauthorized',
        },
      })
    }
  })

  it('filters Organization collections for sessions without memberships', async () => {
    const response = await createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/users',
      {
        headers: userHeaders(),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ users: [] })
  })

  it('uses one Agent principal for permission-gated management operations [spec: agent-identity/agent-single-cli-principal] [spec: agent-identity/agent-management-authority] [spec: management-api/management-restish-agent-auth] [spec: management-api/management-restish-user-crud] [spec: agent-identity/agent-public-resource-model]', async () => {
    const auth = createAuthMock()
    const dpop = await createTestDpopKey()
    let scopes = ['agent:read']
    Object.assign(auth.api, {
      verifyJWT: vi.fn().mockImplementation(async () => ({
        payload: {
          iss: 'http://localhost/api/auth',
          sub: 'agt_1',
          client_id: 'protocol-agent-1',
          host_id: 'host-1',
          scope: scopes.join(' '),
          cnf: { jkt: dpop.thumbprint },
          realmroot_authority: { type: 'realmroot_authority', authority: 'realm', id: 'realm' },
        },
      })),
    })
    const now = new Date()
    const identity = {
      identity: {
        id: 'identity-1',
        issuer: 'http://localhost/api/auth',
        subject: 'agt_1',
        name: 'Build Agent',
        ownerUserId: 'controller-1',
        ownerOrganizationId: null,
        status: 'active',
        retiredAt: null,
        createdAt: now,
        updatedAt: now,
      },
      bindings: [
        {
          id: 'binding-1',
          agentIdentityId: 'identity-1',
          protocolAgentId: 'protocol-agent-1',
          hostId: 'host-1',
          status: 'active',
          boundAt: now,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    const users = createUserRepositoryMock()
    const deps = createTestDeps({
      users,
      agentIdentities: {
        findActiveByProtocolAgent: vi.fn().mockResolvedValue(identity),
        findIdentity: vi.fn().mockResolvedValue(identity),
      },
    })
    const app = createApp(auth, deps)
    const headers = (method: string, path: string) => dpop.headers(method, `http://localhost${path}`)

    const agent = await app.request('/api/agent/status', { headers: await headers('GET', '/api/agent/status') })
    expect(agent.status).toBe(200)
    await expect(agent.json()).resolves.toMatchObject({
      agent: { issuer: 'http://localhost/api/auth', subject: 'agt_1' },
    })

    scopes = ['resource-servers:read']
    const discovery = await app.request('/api/resource-servers', {
      headers: await headers('GET', '/api/resource-servers'),
    })
    expect(discovery.status, await discovery.clone().text()).toBe(200)

    const denied = await app.request('/api/users', { headers: await headers('GET', '/api/users') })
    expect(denied.status, await denied.clone().text()).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({
      error: { message: 'OAuth scope "users:read" is required.' },
    })

    scopes = ['users:read']
    const allowed = await app.request('/api/users', { headers: await headers('GET', '/api/users') })
    expect(allowed.status).toBe(200)

    scopes = ['users:write']
    const created = await app.request('/api/users', {
      method: 'POST',
      headers: { ...(await headers('POST', '/api/users')), 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'managed@example.com',
        displayName: 'Managed User',
        password: 'Sup3rSecurePass!',
        role: 'user',
      }),
    })
    const updated = await app.request('/api/users/user-1', {
      method: 'PATCH',
      headers: { ...(await headers('PATCH', '/api/users/user-1')), 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Updated User' }),
    })
    const removed = await app.request('/api/users/user-1', {
      method: 'DELETE',
      headers: await headers('DELETE', '/api/users/user-1'),
    })

    expect(created.status).toBe(403)
    expect(updated.status).toBe(403)
    expect(removed.status).toBe(403)
    expect(users.createManagedUser).not.toHaveBeenCalled()
    expect(users.updateManagedUser).not.toHaveBeenCalled()
    expect(users.deleteManagedUser).not.toHaveBeenCalled()
  })

  it('does not expose the removed capability request resource', async () => {
    const auth = createAuthMock()
    auth.api.getAgentSession.mockResolvedValue(agentSession())
    auth.handler.mockImplementationOnce(async (request) => {
      expect(new URL(request.url).pathname).toBe('/api/auth/agent/request-capability')
      await expect(request.json()).resolves.toEqual({
        capabilities: ['applications:read', 'applications:write'],
        reason: 'Administer this tenant',
        preferred_method: 'device_authorization',
        binding_message: 'Agent requesting applications:read, applications:write',
      })
      return Response.json({
        agent_id: 'protocol-agent-1',
        status: 'pending',
        agent_capability_grants: [
          { capability: 'applications:read', status: 'pending' },
          { capability: 'applications:write', status: 'pending' },
        ],
        approval: {
          method: 'device_authorization',
          device_code: 'approval-1',
          verification_uri: 'https://auth.example.com/agent/approve',
          verification_uri_complete: 'https://auth.example.com/agent/approve?agent_id=protocol-agent-1&code=ABCD-1234',
          user_code: 'ABCD-1234',
          expires_in: 600,
          interval: 5,
        },
      })
    })
    const deps = createTestDeps({
      agentIdentities: {
        findActiveByProtocolAgent: vi.fn().mockResolvedValue(agentIdentity()),
      },
    })
    vi.mocked(deps.agents.findApprovalRequest).mockResolvedValue({
      id: 'approval-1',
      method: 'device_authorization',
      agentId: 'protocol-agent-1',
      hostId: 'host-1',
      userId: 'controller-1',
      capabilities: 'applications:read applications:write',
      status: 'pending',
      userCodeHash: 'hash',
      loginHint: null,
      bindingMessage: null,
      clientNotificationToken: null,
      clientNotificationEndpoint: null,
      deliveryMode: null,
      interval: 5,
      lastPolledAt: null,
      expiresAt: new Date('2099-01-01T00:10:00.000Z'),
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
      updatedAt: new Date('2099-01-01T00:00:00.000Z'),
    })
    const app = createApp(auth, deps)

    const response = await app.request('https://auth.example.com/api/capability-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer agent-proof',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        capabilities: ['applications:read', 'applications:write'],
        reason: 'Administer this tenant',
      }),
    })

    expect(response.status).toBe(404)
  })
})

async function createTestDpopKey() {
  const accessToken = 'test-oauth-access-token'
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  const thumbprint = await calculateJwkThumbprint(jwk)
  return {
    thumbprint,
    async headers(method: string, requestUrl: string) {
      const url = new URL(requestUrl)
      url.search = ''
      url.hash = ''
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
      const ath = Buffer.from(digest).toString('base64url')
      const proof = await new SignJWT({
        htm: method,
        htu: url.toString(),
        ath,
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(),
      })
        .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk })
        .sign(privateKey)
      return { authorization: `DPoP ${accessToken}`, DPoP: proof }
    },
  }
}

function agentSession() {
  return {
    agentId: 'protocol-agent-1',
    agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated', capabilityGrants: [] },
    host: { id: 'host-1', userId: 'controller-1', status: 'active' },
  }
}

function agentIdentity() {
  const now = new Date()
  return {
    identity: {
      id: 'identity-1',
      issuer: 'https://auth.example.com/api/auth',
      subject: 'agt_1',
      name: 'Build Agent',
      ownerUserId: 'controller-1',
      ownerOrganizationId: null,
      status: 'active',
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    },
    bindings: [
      {
        id: 'binding-1',
        agentIdentityId: 'identity-1',
        protocolAgentId: 'protocol-agent-1',
        hostId: 'host-1',
        status: 'active',
        boundAt: now,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}
