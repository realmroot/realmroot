import type { SecurityRepository, UserRepository } from '@server/usecases/ports'
import { vi } from 'vitest'
import { managementOpenApi } from '../openapi/management'
import { createPage, securityPolicy, updatedSecurityPolicy } from './management.fixture-test-utils'

export function createAuthMock() {
  const auth = {
    api: {
      getOAuthServerConfig: vi.fn(),
      getOpenIdConfig: vi.fn(),
      getSession: vi.fn().mockImplementation(({ headers }: { headers: Headers }) => {
        const id = headers.get('x-user-id')

        if (!id) {
          return null
        }

        return {
          session: { id: 'session-1' },
          user: {
            id,
            email: `${id}@example.com`,
            role: headers.get('x-user-role'),
          },
        }
      }),
      oauth2UserInfo: vi.fn(),
      listUsers: vi.fn().mockResolvedValue({ users: [], total: 0 }),
      getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      createUser: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }),
      adminUpdateUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
      banUser: vi.fn().mockResolvedValue({ user: { id: 'user-1', banned: true } }),
      unbanUser: vi.fn().mockResolvedValue({ user: { id: 'user-1', banned: false } }),
      removeUser: vi.fn().mockResolvedValue({ success: true }),
      revokeUserSession: vi.fn().mockResolvedValue({ success: true }),
      revokeUserSessions: vi.fn().mockResolvedValue({ success: true }),
      requestPasswordReset: vi.fn().mockResolvedValue({ status: true }),
      sendVerificationEmail: vi.fn().mockResolvedValue({ status: true }),
      changeEmail: vi.fn().mockResolvedValue({ status: true }),
      changePassword: vi.fn().mockResolvedValue({ status: true }),
    },
    handler: vi.fn(async (request: Request) => {
      if (!auth.api.oauth2UserInfo) return new Response(null, { status: 404 })
      return Response.json(await auth.api.oauth2UserInfo({ headers: request.headers, asResponse: false }))
    }),
  }
  return auth
}

export function createUserRepositoryMock(): UserRepository {
  return {
    getUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    listManagedUsers: vi.fn().mockImplementation((page) => Promise.resolve(createPage(page))),
    createManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    updateManagedUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    deleteManagedUser: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue({ id: 'user-1' }),
    assertAccountAvatarReference: vi.fn().mockResolvedValue(undefined),
    assertAdminAvatarReference: vi.fn().mockResolvedValue(undefined),
    listLinkedAccounts: vi.fn().mockResolvedValue(createPage({ limit: 50, offset: 0 })),
    listConsentedApplications: vi.fn().mockResolvedValue(createPage({ limit: 50, offset: 0 })),
    listSessions: vi.fn().mockResolvedValue(createPage({ limit: 50, offset: 0 })),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

export function createSecurityRepositoryMock(policy = securityPolicy()): SecurityRepository {
  return {
    getPolicy: vi.fn().mockResolvedValue(policy),
    updatePolicy: vi.fn().mockResolvedValue(updatedSecurityPolicy()),
    getSecurityState: vi.fn().mockResolvedValue({
      userId: 'user-1',
      mfa: { enabled: true, factors: [] },
      passkeys: { enabled: policy.passkeys.enabled, count: 1 },
      policy,
    }),
    listPasskeys: vi.fn().mockImplementation((_userId, page) =>
      Promise.resolve({
        items: [
          {
            id: 'passkey-1',
            name: 'MacBook',
            userId: 'user-1',
            deviceType: 'platform',
            backedUp: true,
            transports: 'internal',
            createdAt: null,
            aaguid: null,
          },
        ],
        limit: page.limit,
        offset: page.offset,
        total: 10,
      }),
    ),
    deletePasskey: vi.fn().mockResolvedValue(undefined),
    getSessionToken: vi.fn().mockResolvedValue('session-token-1'),
  }
}

export function mountedManagementOperations(app: unknown) {
  return [
    ...new Set(
      honoRoutes(app)
        .filter((route) => route.method !== 'ALL')
        .map(toManagementOperationKey),
    ),
  ]
    .filter((key) => key !== null)
    .sort()
}

export function openApiOperations() {
  return openApiOperationObjects()
    .map(({ key }) => key)
    .sort()
}

export function openApiOperationObjects() {
  return Object.entries(managementOpenApi.paths).flatMap(([path, pathItem]) =>
    Object.entries(resolveOpenApiPathItem(pathItem))
      .filter(([method]) => isManagementOpenApiMethod(method))
      .map(([method, operation]) => {
        const resolvedPathItem = resolveOpenApiPathItem(pathItem)
        const resolvedOperation = openApiOperation(operation)
        const key = `${method.toUpperCase()} ${normalizeManagementPath(path)}`
        return {
          key,
          method: method.toUpperCase(),
          pathParameters: pathParameterNames(path),
          declaredPathParameters: declaredPathParameterNames(resolvedPathItem, resolvedOperation),
          operationId: resolvedOperation.operationId,
          requestBody: resolvedOperation.requestBody,
          responses: resolvedOperation.responses,
          security: resolvedOperation.security,
          jsonResponseSchemas: Object.values(resolvedOperation.responses)
            .map((response) => openApiJsonResponseSchema(response))
            .filter((schema) => schema !== null),
        }
      }),
  )
}

export function resolveOpenApiPathItem(pathItem: unknown) {
  const record = openApiRecord(pathItem)
  const ref = record.$ref

  if (typeof ref !== 'string') {
    return record
  }

  const pathItems = managementOpenApi.components.pathItems as Record<string, unknown>
  return openApiRecord(pathItems[ref.replace('#/components/pathItems/', '')])
}

export function toManagementOperationKey(route: HonoRoute) {
  if (!route.path.startsWith('/api/management')) {
    return null
  }

  return `${route.method} ${normalizeManagementPath(route.path.replace('/api/management', '') || '/')}`
}

export function normalizeManagementPath(path: string) {
  return path.replace(/:[^/]+/g, '{param}').replace(/\{[^}]+}/g, '{param}')
}

export function pathParameterNames(path: string) {
  return [...path.matchAll(/\{([^}]+)}/g)].map((match) => match[1]).sort()
}

export function declaredPathParameterNames(pathItem: Record<string, unknown>, operation: OpenApiOperation) {
  return [...openApiParameters(pathItem.parameters), ...openApiParameters(operation.parameters)]
    .filter((parameter) => parameter.in === 'path')
    .map((parameter) => parameter.name)
    .sort()
}

export function openApiParameters(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((parameter) => {
    const record = openApiRecord(parameter)
    const ref = record.$ref
    if (typeof ref !== 'string') {
      return record as unknown as OpenApiParameter
    }

    const parameters = managementOpenApi.components.parameters as Record<string, unknown>
    return openApiRecord(parameters[ref.replace('#/components/parameters/', '')]) as unknown as OpenApiParameter
  })
}

export function requestBodyContent(value: unknown) {
  const content = openApiRecord(openApiRecord(value).content)
  const mediaType = content['application/json'] ?? content['multipart/form-data']
  return openApiRecord(mediaType)
}

export function openApiSchemaObject(value: unknown) {
  const schema = openApiRecord(value)
  const ref = schema.$ref
  return typeof ref === 'string' ? openApiRecord(resolveOpenApiSchemaRef(ref)) : schema
}

export function schemaReference(value: unknown) {
  const ref = openApiRecord(value).$ref
  return typeof ref === 'string' ? ref : null
}

export function assertConstrainedOpenApiSchema(value: unknown, path: string, seen = new Set<string>()) {
  if (value === undefined || value === null || typeof value === 'boolean') {
    throw new Error(`${path} is not a concrete schema object`)
  }

  const schema = openApiRecord(value)
  const ref = schema.$ref
  if (typeof ref === 'string') {
    if (ref === '#/components/schemas/GenericObject') {
      throw new Error(`${path} uses GenericObject`)
    }
    if (seen.has(ref)) {
      return
    }
    seen.add(ref)
    assertConstrainedOpenApiSchema(resolveOpenApiSchemaRef(ref), `${path} ${ref}`, seen)
    return
  }

  if (schema.type === 'object') {
    const properties = schema.properties === undefined ? {} : openApiRecord(schema.properties)
    const additionalProperties = schema.additionalProperties
    if (Object.keys(properties).length === 0 && additionalProperties === undefined) {
      throw new Error(`${path} uses an unconstrained object schema`)
    }
    if (additionalProperties === true) {
      throw new Error(`${path} uses additionalProperties: true`)
    }
    if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') {
      assertConstrainedOpenApiSchema(additionalProperties, `${path} additionalProperties`, seen)
    }
    for (const [property, propertySchema] of Object.entries(properties)) {
      assertConstrainedOpenApiSchema(propertySchema, `${path}.${property}`, seen)
    }
  }

  if (schema.items) {
    assertConstrainedOpenApiSchema(schema.items, `${path}[]`, seen)
  }

  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const variants = schema[key]
    if (Array.isArray(variants)) {
      for (const [index, variant] of variants.entries()) {
        assertConstrainedOpenApiSchema(variant, `${path}.${key}[${index}]`, seen)
      }
    }
  }
}

export function resolveOpenApiSchemaRef(ref: string) {
  const schemas = managementOpenApi.components.schemas as Record<string, unknown>
  return schemas[ref.replace('#/components/schemas/', '')]
}

export function honoRoutes(app: unknown) {
  return (app as { routes: HonoRoute[] }).routes
}

export function openApiRecord(value: unknown) {
  return value as Record<string, unknown>
}

export function openApiOperation(value: unknown) {
  return value as OpenApiOperation
}

export function openApiJsonResponseSchema(value: unknown) {
  const record = openApiRecord(value)
  const ref = record.$ref
  const response =
    typeof ref === 'string' ? openApiRecord(openApiResponses()[ref.replace('#/components/responses/', '')]) : record
  if (response.content === undefined) {
    return null
  }

  const content = openApiRecord(response.content)
  const jsonResponse = content['application/json']

  if (jsonResponse === undefined) {
    return null
  }

  return openApiRecord(jsonResponse).schema
}

export function openApiResponses() {
  return managementOpenApi.components.responses as Record<string, unknown>
}

export function isManagementOpenApiMethod(method: string): method is ManagementOpenApiMethod {
  return managementOpenApiMethods.includes(method as ManagementOpenApiMethod)
}

export const managementOpenApiMethods = ['get', 'post', 'put', 'patch', 'delete'] as const
export type ManagementOpenApiMethod = (typeof managementOpenApiMethods)[number]
export const managementOpenApiOperationKey = 'GET /openapi.json'
export const methodsWithJsonRequestBody = new Set(['POST', 'PUT', 'PATCH'])
export const operationsWithoutRequestBody = new Set([
  'POST /applications/{param}/client-secrets',
  'POST /users/{param}/password-reset-requests',
  'POST /users/{param}/unban',
  'POST /webhooks/endpoints/{param}/secrets',
  'POST /webhooks/requests/{param}/retries',
])

export interface HonoRoute {
  method: string
  path: string
}

export interface OpenApiOperation {
  operationId?: string
  parameters?: unknown
  requestBody?: unknown
  responses: Record<string, unknown>
  security?: unknown
}

export interface OpenApiParameter {
  name: string
  in: string
}
