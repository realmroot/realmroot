import { createApp } from '@server/http/app'
import { unifiedOpenApi } from '@server/http/openapi/management'
import { managementCollectionRoutes } from '@shared/api/management'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDeps } from '../test-deps'
import {
  assertConstrainedOpenApiSchema,
  bearerHeaders,
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
    expect(unifiedOpenApi.security).toEqual([{ agentAuth: [] }, { adminSession: [] }])
    expect(unifiedOpenApi.components.securitySchemes.agentAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'agent+jwt',
    })
    expect(unifiedOpenApi['x-cli-config']).toEqual({
      profiles: {
        default: {
          credentials: {
            agentAuth: {
              auth: {
                type: 'api-key',
                params: {
                  in: 'header',
                  name: 'Authorization',
                  value: 'AgentAuth',
                  provider: 'flareauth-agent',
                },
              },
              params: {
                provider: 'flareauth-agent',
              },
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

      expect(operation.responses, operation.key).toHaveProperty('401')
      expect(operation.responses, operation.key).toHaveProperty('403')
      expect(operation.declaredPathParameters, operation.key).toEqual(operation.pathParameters)

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
    const protectedResponse = await app.request('/api/management/users')

    expect(contract.status).toBe(200)
    expect(contract.headers.get('content-type')).toContain('application/json')
    expect(contract.headers.get('link')).toBeNull()
    await expect(contract.json()).resolves.toEqual(unifiedOpenApi)

    expect(protectedResponse.status).toBe(401)
    expect(protectedResponse.headers.get('link')).toContain('</api/openapi.json>; rel="service-desc"')
  })

  it('documents application setup fields and role permission replacement request bodies', () => {
    const createApplication = openApiOperationObjects().find(
      (operation) => operation.key === 'POST /management/applications',
    )
    const createApplicationSchema = openApiSchemaObject(requestBodyContent(createApplication?.requestBody).schema)
    const createApplicationProperties = openApiRecord(createApplicationSchema.properties)

    expect(createApplicationProperties).toHaveProperty('postLogoutRedirectUris')
    expect(createApplicationProperties).toHaveProperty('corsOrigins')
    expect(createApplicationProperties).not.toHaveProperty('clientId')
    expect(createApplicationProperties).not.toHaveProperty('clientSecret')

    const replaceRolePermissions = openApiOperationObjects().find(
      (operation) => operation.key === 'PUT /management/roles/{param}/permissions',
    )
    const replaceRolePermissionsSchema = openApiSchemaObject(
      requestBodyContent(replaceRolePermissions?.requestBody).schema,
    )
    const replaceRolePermissionsProperties = openApiRecord(replaceRolePermissionsSchema.properties)

    expect(replaceRolePermissionsProperties).toHaveProperty('permissionIds')
    expect(replaceRolePermissionsProperties).not.toHaveProperty('permissions')
    expect(replaceRolePermissions?.responses).toHaveProperty('204')
    expect(replaceRolePermissions?.responses).not.toHaveProperty('200')
  })

  it('mounts the documented management collections behind the admin boundary', async () => {
    const app = createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() }))

    for (const route of managementCollectionRoutes) {
      const response = await app.request(`/api/management${route}`)
      expect(response.status, route).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'unauthorized',
        },
      })
    }
  })

  it('rejects non-admin sessions from management APIs', async () => {
    const response = await createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: userHeaders(),
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Admin access is required.',
      },
    })
  })

  it('keeps accepting legacy Management API Bearer tokens from the CLI client for admin users', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin-1@example.com',
      role: 'admin',
      client_id: 'flareauth-cli',
      scope: 'openid management:read management:write',
    })

    const users = createUserRepositoryMock()
    const response = await createApp(auth, createTestDeps({ users })).request(
      '/api/management/users?limit=10&offset=20',
      { headers: bearerHeaders('valid-admin-token') },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      users: [],
      pagination: {
        limit: 10,
        offset: 20,
      },
    })
    expect(auth.api.oauth2UserInfo).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      asResponse: false,
    })
    expect(users.listManagedUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }))
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('uses one Agent principal for its Agent resource and permission-gated management [spec: agent-identity/agent-single-cli-principal] [spec: agent-identity/agent-management-authority] [spec: management-api/management-restish-oauth-auth] [spec: agent-identity/agent-public-resource-model]', async () => {
    const auth = createAuthMock()
    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: { id: 'protocol-agent-1', hostId: 'host-1', mode: 'delegated', capabilityGrants: [] },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const now = new Date()
    const identity = {
      identity: {
        id: 'identity-1',
        issuer: 'http://localhost',
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
    const deps = createTestDeps({
      users: createUserRepositoryMock(),
      agentIdentities: {
        findActiveByProtocolAgent: vi.fn().mockResolvedValue(identity),
      },
    })
    const app = createApp(auth, deps)
    const headers = {
      'content-type': 'application/json',
      authorization: 'Bearer eyJ0eXAiOiJhZ2VudCtqd3QifQ.e30.c2lnbmF0dXJl',
    }

    const agent = await app.request('/api/agent', { headers })
    expect(agent.status).toBe(200)
    await expect(agent.json()).resolves.toMatchObject({
      agent: { issuer: 'http://localhost', subject: 'agt_1' },
    })

    const denied = await app.request('/api/management/users', { headers })
    expect(denied.status, await denied.clone().text()).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({
      error: { message: 'Agent authority "management:read" is required.' },
    })

    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: {
        id: 'protocol-agent-1',
        hostId: 'host-1',
        mode: 'delegated',
        capabilityGrants: [{ capability: 'management:read', status: 'active' }],
      },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const allowed = await app.request('/api/management/users', { headers })
    expect(allowed.status).toBe(200)
    expect(auth.api.getAgentSession).toHaveBeenCalledTimes(3)
  })

  it('adapts unified capability requests to the existing AgentAuth approval flow [spec: agent-identity/agent-management-authority]', async () => {
    const auth = createAuthMock()
    auth.api.getAgentSession.mockResolvedValue(agentSession())
    auth.handler.mockImplementationOnce(async (request) => {
      expect(new URL(request.url).pathname).toBe('/api/auth/agent/request-capability')
      await expect(request.json()).resolves.toEqual({
        capabilities: ['management:read', 'management:write'],
        reason: 'Administer this tenant',
        preferred_method: 'device_authorization',
        binding_message: 'Agent requesting management:read, management:write',
      })
      return Response.json({
        agent_id: 'protocol-agent-1',
        status: 'pending',
        agent_capability_grants: [
          { capability: 'management:read', status: 'pending' },
          { capability: 'management:write', status: 'pending' },
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
    const app = createApp(
      auth,
      createTestDeps({
        agentIdentities: {
          findActiveByProtocolAgent: vi.fn().mockResolvedValue(agentIdentity()),
        },
      }),
    )

    const response = await app.request('https://auth.example.com/api/agent/management-access-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer agent-proof',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        capabilities: ['management:read', 'management:write'],
        reason: 'Administer this tenant',
      }),
    })

    expect(response.status).toBe(200)
    expect(auth.api.getAgentSession).not.toHaveBeenCalled()
    const body = (await response.json()) as {
      approval: { verification_uri_complete: string }
    }
    const approvalUrl = new URL(body.approval.verification_uri_complete)
    expect(approvalUrl.pathname).toBe('/agent/approve')
    expect(approvalUrl.searchParams.getAll('capability')).toEqual(['management:read', 'management:write'])
  })

  it('accepts Management API Bearer tokens verified through the OAuth userinfo route handler', async () => {
    const auth = createAuthMock()
    auth.handler = vi.fn().mockResolvedValue(
      Response.json({
        sub: 'admin-1',
        email: 'admin-1@example.com',
        role: 'admin',
        client_id: 'flareauth-cli',
        scope: 'openid management:read management:write',
      }),
    )

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users?limit=10&offset=20',
      { headers: bearerHeaders('valid-admin-token') },
    )

    expect(response.status).toBe(200)
    expect(auth.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost/api/auth/oauth2/userinfo',
      }),
    )
    expect(auth.api.oauth2UserInfo).not.toHaveBeenCalled()
  })

  it('rejects non-admin Management API Bearer tokens with 403', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'user-1',
      email: 'user-1@example.com',
      role: 'user',
      client_id: 'flareauth-cli',
      scope: 'openid management:read management:write',
    })

    const app = createApp(auth, createTestDeps({ users: createUserRepositoryMock() }))
    const response = await app.request('/api/management/users', { headers: bearerHeaders('valid-user-token') })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
        message: 'Admin access is required.',
      },
    })
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('rejects invalid Management API Bearer tokens with 401', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockRejectedValue(new Error('token expired'))

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: bearerHeaders('expired-token'),
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'unauthorized',
        message: 'Invalid bearer token.',
      },
    })
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('rejects Management API Bearer tokens when token verification is unavailable', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo = undefined as never

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: bearerHeaders('valid-admin-token'),
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'unauthorized',
        message: 'Invalid bearer token.',
      },
    })
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('rejects Management API Bearer tokens from non-CLI OAuth clients', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin-1@example.com',
      role: 'admin',
      client_id: 'browser-admin',
      scope: 'openid management:read management:write',
    })

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: bearerHeaders('wrong-client-token'),
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
      },
    })
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('rejects malformed Management API Bearer authorization headers with 401', async () => {
    const auth = createAuthMock()

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer',
        },
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'unauthorized',
        message: 'Invalid bearer token.',
      },
    })
    expect(auth.api.oauth2UserInfo).not.toHaveBeenCalled()
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })

  it('requires management write scope for mutating Bearer-token requests', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin-1@example.com',
      role: 'admin',
      client_id: 'flareauth-cli',
      scope: 'openid management:read',
    })

    const response = await createApp(auth, createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/management/users',
      {
        method: 'POST',
        headers: bearerHeaders('read-only-token'),
        body: JSON.stringify({
          email: 'new-user@example.com',
          password: 'Sup3rSecurePass!',
          name: 'New User',
          role: 'user',
        }),
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'forbidden',
      },
    })
    expect(auth.api.createUser).not.toHaveBeenCalled()
  })

  it('uses repository-backed user mutations for Management API Bearer tokens', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin-1@example.com',
      role: 'admin',
      client_id: 'flareauth-cli',
      scope: 'openid management:read management:write',
    })
    const users = createUserRepositoryMock()
    const app = createApp(auth, createTestDeps({ users }))
    const headers = bearerHeaders('write-token')

    const created = await app.request('/api/management/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'new-user@example.com',
        displayName: 'New User',
        password: 'Sup3rSecurePass!',
        role: 'user',
      }),
    })
    const updated = await app.request('/api/management/users/user-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ displayName: 'Updated User' }),
    })
    const deleted = await app.request('/api/management/users/user-1', {
      method: 'DELETE',
      headers,
    })
    const selfDelete = await app.request('/api/management/users/admin-1', {
      method: 'DELETE',
      headers,
    })

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toEqual({ user: { id: 'user-1' } })
    expect(updated.status).toBe(200)
    await expect(updated.json()).resolves.toEqual({ user: { id: 'user-1' } })
    expect(deleted.status).toBe(204)
    expect(selfDelete.status).toBe(400)
    expect(users.createManagedUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'new-user@example.com' }))
    expect(users.updateManagedUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ displayName: 'Updated User' }),
    )
    expect(users.deleteManagedUser).toHaveBeenCalledWith('user-1')
    expect(auth.api.createUser).not.toHaveBeenCalled()
    expect(auth.api.adminUpdateUser).not.toHaveBeenCalled()
    expect(auth.api.removeUser).not.toHaveBeenCalled()
  })

  it('accepts CLI Bearer tokens when admin access comes from OAuth roles claims', async () => {
    const auth = createAuthMock()
    auth.api.oauth2UserInfo.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin-1@example.com',
      client_id: 'flareauth-cli',
      scope: 'openid management:read',
      authorization: {
        roles: ['admin'],
      },
    })

    const users = createUserRepositoryMock()
    const response = await createApp(auth, createTestDeps({ users })).request('/api/management/users', {
      headers: bearerHeaders('roles-admin-token'),
    })

    expect(response.status).toBe(200)
    expect(users.listManagedUsers).toHaveBeenCalledOnce()
    expect(auth.api.listUsers).not.toHaveBeenCalled()
  })
})

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
