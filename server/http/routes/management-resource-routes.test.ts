import * as applicationsUsecase from '@server/usecases/applications'
import * as authorizationUsecase from '@server/usecases/authorization'
import * as connectorsUsecase from '@server/usecases/connectors'
import * as externalResourcesUsecase from '@server/usecases/external-resources'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDeps } from '../test-deps'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('management resource routes', () => {
  it('routes application management requests to the application service', async () => {
    const { app, applicationService } = await loadAppRoutes()

    await expectJson(app, '/applications?limit=10&offset=0', 'GET', undefined, 200)
    await expectJson(
      app,
      '/applications',
      'POST',
      { name: 'Portal', clientType: 'public_spa', redirectUris: ['https://app.example.com/callback'] },
      201,
    )
    await expectJson(app, '/applications/app-1', 'GET', undefined, 200)
    await expectJson(app, '/applications/app-1', 'PATCH', { disabled: true }, 200)
    await expectStatus(app, '/applications/app-1', 'DELETE', undefined, 204)
    await expectJson(app, '/applications/app-1/redirect-uris?limit=1&offset=1', 'GET', undefined, 200)
    await expectJson(
      app,
      '/applications/app-1/redirect-uris',
      'PUT',
      { redirectUris: ['https://next.example.com/callback'] },
      200,
    )
    await expectJson(app, '/applications/app-1/client-secrets', 'GET', undefined, 200)
    await expectJson(app, '/applications/app-1/client-secrets', 'POST', undefined, 201)

    expect(applicationService.list).toHaveBeenCalledWith({ limit: 10, offset: 0 })
    expect(applicationService.create).toHaveBeenCalledWith(
      { name: 'Portal', clientType: 'public_spa', redirectUris: ['https://app.example.com/callback'] },
      'admin-1',
    )
    expect(applicationService.replaceRedirectUris).toHaveBeenCalledWith('app-1', {
      redirectUris: ['https://next.example.com/callback'],
    })
    expect(applicationService.rotateSecret).toHaveBeenCalledWith('app-1', 'admin-1')
  })

  it('routes organization and membership requests to the authorization service', async () => {
    const { app, authorizationService } = await loadAuthorizationRoutes()

    await expectJson(app, '/organizations', 'GET', undefined, 200)
    await expectJson(app, '/organizations', 'POST', { slug: 'acme', name: 'Acme' }, 201)
    await expectJson(app, '/organizations/org-1', 'GET', undefined, 200)
    await expectJson(app, '/organizations/org-1', 'PATCH', { disabled: true }, 200)
    await expectStatus(app, '/organizations/org-1', 'DELETE', undefined, 204)
    await expectJson(app, '/organizations/org-1/members', 'GET', undefined, 200)
    await expectJson(app, '/organizations/org-1/members', 'POST', { userId: 'user-1', role: 'member' }, 201)
    await expectJson(app, '/organizations/org-1/members/member-1', 'PATCH', { role: 'owner' }, 200)
    await expectStatus(app, '/organizations/org-1/members/member-1', 'DELETE', undefined, 204)
    await expectJson(app, '/organizations/org-1/invitations', 'GET', undefined, 200)
    await expectJson(app, '/organizations/org-1/invitations', 'POST', { email: 'new@example.com', role: 'member' }, 201)
    await expectStatus(app, '/organizations/org-1/invitations/invitation-1', 'DELETE', undefined, 204)

    expect(authorizationService.createInvitation).toHaveBeenCalledWith(
      'org-1',
      { email: 'new@example.com', role: 'member' },
      'admin-1',
    )
    expect(authorizationService.removeMember).toHaveBeenCalledWith('org-1', 'member-1')
  })

  it('routes API resource, role scope, and assignment requests', async () => {
    const { app, authorizationService } = await loadAuthorizationRoutes()

    await expectJson(app, '/api-resources', 'GET', undefined, 200)
    await expectJson(
      app,
      '/api-resources',
      'POST',
      {
        identifier: 'contacts',
        name: 'Contacts',
        resourceUrl: 'https://api.example.com',
      },
      201,
    )
    await expectJson(app, '/api-resources/resource-1', 'GET', undefined, 200)
    await expectJson(app, '/api-resources/resource-1', 'PATCH', { enabled: false }, 200)
    await expectStatus(app, '/api-resources/resource-1', 'DELETE', undefined, 204)
    await expectJson(app, '/roles', 'GET', undefined, 200)
    await expectJson(app, '/roles', 'POST', { key: 'admin', name: 'Admin' }, 201)
    await expectJson(app, '/roles/role-1', 'GET', undefined, 200)
    await expectJson(app, '/roles/role-1', 'PATCH', { name: 'Owner' }, 200)
    await expectStatus(app, '/roles/role-1', 'DELETE', undefined, 204)
    await expectJson(app, '/roles/role-1/scopes', 'GET', undefined, 200)
    await expectStatus(app, '/roles/role-1/scopes', 'PUT', { scopes: ['contacts.read'] }, 204)
    await expectStatus(app, '/roles/assignments/users', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/roles/assignments/applications', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/roles/assignments/members', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/roles/assignments/agents', 'POST', assignmentBody(), 204)

    expect(authorizationService.replaceRoleScopes).toHaveBeenCalledWith('role-1', ['contacts.read'])
    expect(authorizationService.assignUserRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
    expect(authorizationService.assignApplicationRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
    expect(authorizationService.assignMemberRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
    expect(authorizationService.assignAgentRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
  })

  it('uses the configured origin for dynamic external client registration [spec: agent-identity/external-api-resource-canonical-callback]', async () => {
    const createExternal = vi.spyOn(externalResourcesUsecase, 'createExternalApiResource').mockResolvedValue({
      id: 'resource-1',
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: 'https://projects.example.com/api',
      description: null,
      authorizationMode: 'external',
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      authorization: {
        resourceUrl: 'https://projects.example.com/api',
        issuer: 'https://projects.example.com',
        authorizationEndpoint: 'https://projects.example.com/authorize',
        tokenEndpoint: 'https://projects.example.com/token',
        registrationEndpoint: 'https://projects.example.com/register',
        revocationEndpoint: 'https://projects.example.com/revoke',
        jwksUri: 'https://projects.example.com/jwks',
        userInfoEndpoint: 'https://projects.example.com/userinfo',
        registrationMode: 'dynamic',
        clientId: 'client',
        clientSecretConfigured: true,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    const { app } = await loadAuthorizationRoutes()

    const response = await app.request('https://preview.example.net/api-resources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        identifier: 'projects',
        name: 'Projects',
        resourceUrl: 'https://projects.example.com/api',
        authorizationMode: 'external',
        authorization: {
          registrationMode: 'dynamic',
        },
      }),
    })

    expect(response.status).toBe(201)
    expect(createExternal).toHaveBeenCalledWith(
      expect.anything(),
      {
        identifier: 'projects',
        name: 'Projects',
        resourceUrl: 'https://projects.example.com/api',
        authorizationMode: 'external',
      },
      {
        registrationMode: 'dynamic',
      },
      'https://auth.example.com',
    )
  })

  it('routes management connector requests to the connector service', async () => {
    const { app, connectorService } = await loadConnectorRoutes()

    await expectJson(app, '/connectors/templates', 'GET', undefined, 200)
    await expectJson(app, '/connectors?limit=10&offset=0', 'GET', undefined, 200)
    await expectJson(
      app,
      '/connectors',
      'POST',
      {
        providerId: 'github',
        providerType: 'social',
        displayName: 'GitHub',
        clientId: 'client-id',
        clientSecret: 'GITHUB_SECRET',
      },
      201,
    )
    await expectJson(app, '/connectors/connector-1', 'GET', undefined, 200)
    await expectJson(app, '/connectors/connector-1', 'PATCH', { enabled: false }, 200)
    await expectStatus(app, '/connectors/connector-1', 'DELETE', undefined, 204)

    expect(connectorService.listTemplates).toHaveBeenCalled()
    expect(connectorService.list).toHaveBeenCalledWith({ limit: 10, offset: 0 })
    expect(connectorService.create).toHaveBeenCalledWith({
      providerId: 'github',
      providerType: 'social',
      displayName: 'GitHub',
      clientId: 'client-id',
      clientSecret: 'GITHUB_SECRET',
    })
    expect(connectorService.update).toHaveBeenCalledWith('connector-1', { enabled: false })
    expect(connectorService.delete).toHaveBeenCalledWith('connector-1')
  })
})

async function loadAppRoutes() {
  const applicationService = applicationServiceMock()
  vi.spyOn(applicationsUsecase, 'listApplications').mockImplementation((_d, _i, q) => applicationService.list(q))
  vi.spyOn(applicationsUsecase, 'getApplication').mockImplementation((_d, _i, id) => applicationService.get(id))
  vi.spyOn(applicationsUsecase, 'updateApplication').mockImplementation((_d, _i, id, b) =>
    applicationService.update(id, b),
  )
  vi.spyOn(applicationsUsecase, 'deleteApplication').mockImplementation((_d, id) => applicationService.delete(id))
  vi.spyOn(applicationsUsecase, 'replaceRedirectUris').mockImplementation((_d, _i, id, b) =>
    applicationService.replaceRedirectUris(id, b),
  )
  vi.spyOn(applicationsUsecase, 'createApplication').mockImplementation((_d, _i, b, actor) =>
    applicationService.create(b, actor),
  )
  vi.spyOn(applicationsUsecase, 'listApplicationSecrets').mockImplementation((_d, id, q) =>
    applicationService.listSecrets(id, q),
  )
  vi.spyOn(applicationsUsecase, 'rotateApplicationSecret').mockImplementation((_d, id, actor) =>
    applicationService.rotateSecret(id, actor),
  )

  const { managementApplicationsRoute } = await import('@server/http/routes/management/applications')
  const app = withAdminContext()
  app.route('/applications', managementApplicationsRoute)
  return { app, applicationService }
}

async function loadAuthorizationRoutes() {
  const authorizationService = authorizationServiceMock()
  const apiResource = {
    id: 'resource-1',
    identifier: 'contacts',
    name: 'Contacts',
    resourceUrl: 'https://api.example.com',
    description: null,
    authorizationMode: 'native' as const,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    authorization: null,
  }
  vi.spyOn(externalResourcesUsecase, 'listApiResources').mockResolvedValue({
    items: [apiResource],
    pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
  })
  vi.spyOn(externalResourcesUsecase, 'getApiResource').mockResolvedValue(apiResource)
  const usecaseModule = authorizationUsecase as unknown as Record<string, (...args: unknown[]) => unknown>
  for (const name of Object.keys(authorizationService)) {
    const delegate = authorizationService[name as keyof typeof authorizationService] as (...a: unknown[]) => unknown
    vi.spyOn(usecaseModule, name).mockImplementation((_d: unknown, ...args: unknown[]) => delegate(...args))
  }

  const { createManagementApiResourcesRoute } = await import('@server/http/routes/management/api-resources')
  const { managementOrganizationsRoute } = await import('@server/http/routes/management/organizations')
  const { managementRolesRoute } = await import('@server/http/routes/management/roles')
  const { createProtectedResourceRoutes } = await import('@server/http/routes/management')
  const app = withAdminContext()
  app.route('/api-resources', createManagementApiResourcesRoute('https://auth.example.com'))
  app.route('/organizations', managementOrganizationsRoute)
  app.route('/roles', managementRolesRoute)
  app.route('/', createProtectedResourceRoutes({ authApi: {} as never, canonicalOrigin: 'https://auth.example.com' }))
  return { app, authorizationService }
}

async function loadConnectorRoutes() {
  const connectorService = connectorServiceMock()
  vi.spyOn(connectorsUsecase, 'listConnectors').mockImplementation((_d, p) => connectorService.list(p))
  vi.spyOn(connectorsUsecase, 'getConnector').mockImplementation((_d, id) => connectorService.get(id))
  vi.spyOn(connectorsUsecase, 'connectorReadiness').mockImplementation((_d, id) => connectorService.readiness(id))
  vi.spyOn(connectorsUsecase, 'createConnector').mockImplementation((_d, b) => connectorService.create(b))
  vi.spyOn(connectorsUsecase, 'updateConnector').mockImplementation((_d, id, b) => connectorService.update(id, b))
  vi.spyOn(connectorsUsecase, 'deleteConnector').mockImplementation((_d, id) => connectorService.delete(id))
  vi.spyOn(connectorsUsecase, 'listConnectorTemplates').mockImplementation(() => connectorService.listTemplates())

  const { createManagementConnectorRoutes } = await import('@server/http/routes/management/connectors')
  const app = withAdminContext()
  app.route('/connectors', createManagementConnectorRoutes())
  return { app, connectorService }
}

function withAdminContext() {
  const app = new Hono()
  const deps = createTestDeps()
  app.use('*', async (c, next) => {
    const user = { id: 'admin-1', role: 'admin' }
    c.set('principal', {
      session: { session: { id: 'session-1' }, user },
      user,
    })
    c.set('deps', deps)
    await next()
  })
  return app
}

async function expectJson(app: Hono, path: string, method: string, body: unknown, status: number) {
  const response = await request(app, path, method, body)
  expect(response.status, `${method} ${path}`).toBe(status)
  await expect(response.json()).resolves.toBeDefined()
}

async function expectStatus(app: Hono, path: string, method: string, body: unknown, status: number) {
  const response = await request(app, path, method, body)
  expect(response.status, `${method} ${path}`).toBe(status)
}

function request(app: Hono, path: string, method: string, body: unknown) {
  return app.request(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function applicationServiceMock() {
  const application = {
    id: 'app-1',
    redirectUris: ['https://app.example.com/callback', 'https://next.example.com/callback'],
  }
  return {
    list: vi.fn().mockResolvedValue({ applications: [application], pagination: { limit: 10, offset: 0, total: 1 } }),
    create: vi.fn().mockResolvedValue(application),
    get: vi.fn().mockResolvedValue(application),
    update: vi.fn().mockResolvedValue(application),
    delete: vi.fn().mockResolvedValue(undefined),
    replaceRedirectUris: vi
      .fn()
      .mockResolvedValue({ ...application, redirectUris: ['https://next.example.com/callback'] }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [], pagination: { limit: 50, offset: 0, total: 0 } }),
    rotateSecret: vi.fn().mockResolvedValue({ id: 'secret-1' }),
  }
}

function authorizationServiceMock() {
  const page = { items: [], pagination: { limit: 50, offset: 0, total: 0 } }
  return {
    listOrganizations: vi.fn().mockResolvedValue(page),
    createOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }),
    getOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }),
    updateOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }),
    deleteOrganization: vi.fn().mockResolvedValue(undefined),
    listMembers: vi.fn().mockResolvedValue(page),
    addMember: vi.fn().mockResolvedValue({ id: 'member-1' }),
    updateMember: vi.fn().mockResolvedValue({ id: 'member-1' }),
    removeMember: vi.fn().mockResolvedValue(undefined),
    listInvitations: vi.fn().mockResolvedValue(page),
    createInvitation: vi.fn().mockResolvedValue({ id: 'invitation-1' }),
    cancelInvitation: vi.fn().mockResolvedValue(undefined),
    listResources: vi.fn().mockResolvedValue(page),
    createResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    getResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    updateResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    deleteResource: vi.fn().mockResolvedValue(undefined),
    listRoles: vi.fn().mockResolvedValue(page),
    createRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
    getRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
    updateRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    listRoleScopes: vi.fn().mockResolvedValue({ scopes: [] }),
    replaceRoleScopes: vi.fn().mockResolvedValue(undefined),
    assignUserRole: vi.fn().mockResolvedValue(undefined),
    assignApplicationRole: vi.fn().mockResolvedValue(undefined),
    assignMemberRole: vi.fn().mockResolvedValue(undefined),
    assignAgentRole: vi.fn().mockResolvedValue(undefined),
  }
}

function connectorServiceMock() {
  const connector = {
    id: 'connector-1',
    slug: 'github',
    providerType: 'social',
    providerId: 'github',
    displayName: 'GitHub',
    enabled: true,
    clientId: 'client-id',
    clientSecretConfigured: true,
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    scopes: [],
    providerMetadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  return {
    listTemplates: vi.fn().mockReturnValue({
      templates: [
        {
          providerType: 'social',
          providerId: 'github',
          displayName: 'GitHub',
          icon: 'github',
          requiredFields: [],
          optionalFields: [],
          defaultScopes: [],
          endpoints: {
            issuer: null,
            authorizationEndpoint: null,
            tokenEndpoint: null,
            userInfoEndpoint: null,
            jwksEndpoint: null,
          },
        },
      ],
    }),
    list: vi.fn().mockResolvedValue({
      connectors: [connector],
      pagination: { limit: 10, offset: 0, total: 1, hasMore: false, nextOffset: null },
    }),
    create: vi.fn().mockResolvedValue(connector),
    get: vi.fn().mockResolvedValue(connector),
    update: vi.fn().mockResolvedValue({ ...connector, enabled: false }),
    readiness: vi.fn().mockResolvedValue({ connectorId: 'connector-1', ready: true, checks: [] }),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function assignmentBody() {
  return { roleId: 'role-1', subjectId: 'subject-1' }
}
