import { createApp } from '@server/http/app'
import { managementOpenApi, managementOpenApiForRequest } from '@server/http/openapi/management'
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

  it('keeps the Management OpenAPI route inventory aligned with mounted routes', () => {
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
    expect(managementOpenApi.security).toEqual([{ adminSession: [] }, { managementOAuth2: [] }])
    expect(managementOpenApi.components.securitySchemes.managementOAuth2).toMatchObject({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: '/api/auth/oauth2/authorize',
          tokenUrl: '/api/auth/oauth2/token',
        },
      },
    })
    expect(managementOpenApi['x-cli-config']).toEqual({
      security: 'managementOAuth2',
      params: {
        client_id: 'flareauth-cli',
        scopes: 'openid,profile,email,offline_access,management:read,management:write',
        redirect_url: 'http://localhost:8484/callback',
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

  it('serves the Management OpenAPI contract with Restish discovery headers [spec: management-api/management-openapi-discovery]', async () => {
    const app = createApp(
      createAuthMock(),
      createTestDeps({
        users: createUserRepositoryMock(),
        security: createSecurityRepositoryMock(),
      }),
      { securityPolicy: securityPolicy() },
    )

    const contract = await app.request('/api/management/openapi.json')
    const protectedResponse = await app.request('/api/management/users')

    expect(contract.status).toBe(200)
    expect(contract.headers.get('content-type')).toContain('application/json')
    expect(contract.headers.get('link')).toBeNull()
    await expect(contract.json()).resolves.toEqual(
      managementOpenApiForRequest('http://localhost/api/management/openapi.json'),
    )

    expect(protectedResponse.status).toBe(401)
    expect(protectedResponse.headers.get('link')).toContain('</api/management/openapi.json>; rel="service-desc"')
  })

  it('documents application setup fields and role permission replacement request bodies', () => {
    const createApplication = openApiOperationObjects().find((operation) => operation.key === 'POST /applications')
    const createApplicationSchema = openApiSchemaObject(requestBodyContent(createApplication?.requestBody).schema)
    const createApplicationProperties = openApiRecord(createApplicationSchema.properties)

    expect(createApplicationProperties).toHaveProperty('postLogoutRedirectUris')
    expect(createApplicationProperties).toHaveProperty('corsOrigins')
    expect(createApplicationProperties).not.toHaveProperty('clientId')
    expect(createApplicationProperties).not.toHaveProperty('clientSecret')

    const replaceRolePermissions = openApiOperationObjects().find(
      (operation) => operation.key === 'PUT /roles/{param}/permissions',
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

  it('accepts Management API Bearer tokens from the CLI client for admin users [spec: management-api/management-restish-oauth-auth]', async () => {
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
