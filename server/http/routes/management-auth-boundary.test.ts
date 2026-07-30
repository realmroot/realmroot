import { createApp } from '@server/http/app'
import { unifiedOpenApi } from '@server/http/openapi/management'
import { protectedResourceCollectionRoutes } from '@shared/api/management'
import { protectedResourceCapabilityNames, requiredProtectedCapability } from '@shared/authz'
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
    expect(unifiedOpenApi.security).toEqual([{ agentAuth: [] }, { adminSession: ['admin'] }])
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
                  provider: 'realmroot-agent',
                },
              },
              params: {
                provider: 'realmroot-agent',
              },
              satisfies: protectedResourceCapabilityNames,
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
      const requiredCapability = requiredProtectedCapability(
        operation.method,
        operation.key.slice(operation.method.length + 1),
      )
      if (requiredCapability) {
        expect(operation.security, operation.key).toEqual([
          { agentAuth: [requiredCapability] },
          { adminSession: ['admin'] },
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
    const protectedResponse = await app.request('/api/users')

    expect(contract.status).toBe(200)
    expect(contract.headers.get('content-type')).toContain('application/json')
    expect(contract.headers.get('link')).toBeNull()
    await expect(contract.json()).resolves.toEqual(unifiedOpenApi)

    expect(protectedResponse.status).toBe(401)
    expect(protectedResponse.headers.get('link')).toContain('</api/openapi.json>; rel="service-desc"')
  })

  it('limits generated Restish commands to approval and credential workflows [spec: management-api/management-restish-command-surface]', () => {
    const generatedCommands = openApiOperationObjects()
      .filter((operation) => operation.cliHidden !== true)
      .map((operation) => ({
        group: operation.tags?.[0],
        name: operation.cliName,
        operationId: operation.operationId,
      }))

    expect(generatedCommands).toEqual([
      { group: 'auth', name: 'whoami', operationId: 'getCurrentAgent' },
      { group: 'access', name: 'request', operationId: 'createAgentAccessRequest' },
      { group: 'access', name: 'token', operationId: 'issueTargetAccessToken' },
      { group: 'capability', name: 'request', operationId: 'requestAgentCapabilities' },
    ])
  })

  it('documents application setup fields and role scope replacement request bodies', () => {
    const createApplication = openApiOperationObjects().find((operation) => operation.key === 'POST /applications')
    const createApplicationSchema = openApiSchemaObject(requestBodyContent(createApplication?.requestBody).schema)
    const createApplicationProperties = openApiRecord(createApplicationSchema.properties)

    expect(createApplicationProperties).toHaveProperty('postLogoutRedirectUris')
    expect(createApplicationProperties).toHaveProperty('corsOrigins')
    expect(createApplicationProperties).not.toHaveProperty('clientId')
    expect(createApplicationProperties).not.toHaveProperty('clientSecret')

    const replaceRoleScopes = openApiOperationObjects().find(
      (operation) => operation.key === 'PUT /roles/{param}/scopes',
    )
    const replaceRoleScopesSchema = openApiSchemaObject(requestBodyContent(replaceRoleScopes?.requestBody).schema)
    const replaceRoleScopesProperties = openApiRecord(replaceRoleScopesSchema.properties)

    expect(replaceRoleScopesProperties).toHaveProperty('scopes')
    expect(replaceRoleScopes?.responses).toHaveProperty('204')
    expect(replaceRoleScopes?.responses).not.toHaveProperty('200')
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

  it('rejects non-admin sessions from management APIs', async () => {
    const response = await createApp(createAuthMock(), createTestDeps({ users: createUserRepositoryMock() })).request(
      '/api/users',
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

  it('uses one Agent principal for permission-gated management operations [spec: agent-identity/agent-single-cli-principal] [spec: agent-identity/agent-management-authority] [spec: management-api/management-restish-agent-auth] [spec: management-api/management-restish-user-crud] [spec: agent-identity/agent-public-resource-model]', async () => {
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
    const users = createUserRepositoryMock()
    const deps = createTestDeps({
      users,
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

    const denied = await app.request('/api/users', { headers })
    expect(denied.status, await denied.clone().text()).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({
      error: { message: 'Agent capability "users:read" is required.' },
    })

    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: {
        id: 'protocol-agent-1',
        hostId: 'host-1',
        mode: 'delegated',
        capabilityGrants: [{ capability: 'users:read', status: 'active' }],
      },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const allowed = await app.request('/api/users', { headers })
    expect(allowed.status).toBe(200)

    auth.api.getAgentSession.mockResolvedValue({
      agentId: 'protocol-agent-1',
      agent: {
        id: 'protocol-agent-1',
        hostId: 'host-1',
        mode: 'delegated',
        capabilityGrants: [
          { capability: 'users:read', status: 'active' },
          { capability: 'users:write', status: 'active' },
        ],
      },
      host: { id: 'host-1', userId: 'controller-1', status: 'active' },
    })
    const created = await app.request('/api/users', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'managed@example.com',
        displayName: 'Managed User',
        password: 'Sup3rSecurePass!',
        role: 'user',
      }),
    })
    const updated = await app.request('/api/users/user-1', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ displayName: 'Updated User' }),
    })
    const removed = await app.request('/api/users/user-1', {
      method: 'DELETE',
      headers,
    })

    expect(created.status).toBe(201)
    expect(updated.status).toBe(200)
    expect(removed.status).toBe(204)
    expect(users.createManagedUser).toHaveBeenCalledOnce()
    expect(users.updateManagedUser).toHaveBeenCalledOnce()
    expect(users.deleteManagedUser).toHaveBeenCalledOnce()
  })

  it('adapts unified capability requests to the existing AgentAuth approval flow [spec: agent-identity/agent-management-authority]', async () => {
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
    const app = createApp(
      auth,
      createTestDeps({
        agentIdentities: {
          findActiveByProtocolAgent: vi.fn().mockResolvedValue(agentIdentity()),
        },
      }),
    )

    const response = await app.request('https://auth.example.com/api/agent/capability-requests', {
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

    expect(response.status).toBe(200)
    expect(auth.api.getAgentSession).not.toHaveBeenCalled()
    const body = (await response.json()) as {
      approval: { verification_uri_complete: string }
    }
    const approvalUrl = new URL(body.approval.verification_uri_complete)
    expect(approvalUrl.pathname).toBe('/agent/approve')
    expect(approvalUrl.searchParams.getAll('capability')).toEqual(['applications:read', 'applications:write'])
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
