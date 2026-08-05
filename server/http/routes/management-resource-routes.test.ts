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
    const createdApplication = await expectJson(
      app,
      '/applications',
      'POST',
      { name: 'Portal', clientType: 'public_spa', redirectUris: ['https://app.example.com/callback'] },
      201,
    )
    expect(createdApplication.headers.get('location')).toBe('/api/applications/app-1')
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
    await expectJson(app, '/application-authorizations?applicationId=app-1&limit=10&offset=0', 'GET', undefined, 200)
    await expectJson(app, '/application-authorizations/authorization-1', 'GET', undefined, 200)
    await expectJson(app, '/application-authorizations/authorization-1/revocation', 'PUT', undefined, 200)

    expect(applicationService.list).toHaveBeenCalledWith({ limit: 10, offset: 0 })
    expect(applicationService.create).toHaveBeenCalledWith(
      { name: 'Portal', clientType: 'public_spa', redirectUris: ['https://app.example.com/callback'] },
      'admin-1',
    )
    expect(applicationService.replaceRedirectUris).toHaveBeenCalledWith('app-1', {
      redirectUris: ['https://next.example.com/callback'],
    })
    expect(applicationService.rotateSecret).toHaveBeenCalledWith('app-1', 'admin-1')
    expect(applicationService.listAuthorizations).toHaveBeenCalledWith({ applicationId: 'app-1', limit: 10, offset: 0 })
    expect(applicationService.revokeAuthorization).toHaveBeenCalledWith('authorization-1')
  })

  it('routes organization and membership requests to the authorization service [spec: admin-console/organization-console-resource-boundary]', async () => {
    const { app, authorizationService } = await loadAuthorizationRoutes()

    await expectJson(app, '/organizations', 'GET', undefined, 200)
    const createdOrganization = await expectJson(app, '/organizations', 'POST', { slug: 'acme', name: 'Acme' }, 201)
    expect(createdOrganization.headers.get('location')).toBe('/api/organizations/org-1')
    await expectJson(app, '/organizations/org-1', 'GET', undefined, 200)
    await expectJson(app, '/organizations/org-1', 'PATCH', { disabled: true }, 200)
    await expectStatus(app, '/organizations/org-1', 'DELETE', undefined, 204)
    await expectJson(app, '/organizations/org-1/members', 'GET', undefined, 200)
    const createdMember = await expectJson(
      app,
      '/organizations/org-1/members',
      'POST',
      { userId: 'user-1', roles: ['member'] },
      201,
    )
    expect(createdMember.headers.get('location')).toBe('/api/organizations/org-1/members/member-1')
    await expectJson(app, '/organizations/org-1/members/member-1', 'PATCH', { title: 'Lead' }, 200)
    await expectJson(app, '/organizations/org-1/members/member-1/roles', 'PUT', { roles: ['developer', 'member'] }, 200)
    await expectStatus(app, '/organizations/org-1/members/member-1', 'DELETE', undefined, 204)
    await expectJson(app, '/organizations/org-1/invitations', 'GET', undefined, 200)
    const createdInvitation = await expectJson(
      app,
      '/organizations/org-1/invitations',
      'POST',
      { email: 'new@example.com', roles: ['member'] },
      201,
    )
    expect(createdInvitation.headers.get('location')).toBe('/api/organizations/org-1/invitations/invitation-1')
    await expectStatus(app, '/organizations/org-1/invitations/invitation-1', 'DELETE', undefined, 204)

    expect(authorizationService.createInvitation).toHaveBeenCalledWith(
      'org-1',
      { email: 'new@example.com', roles: ['member'] },
      'admin-1',
      true,
    )
    expect(authorizationService.removeMember).toHaveBeenCalledWith('org-1', 'member-1', 'admin-1')
  })

  it('routes API resource and Organization Role requests', async () => {
    const { app } = await loadAuthorizationRoutes()

    await expectJson(app, '/resource-servers', 'GET', undefined, 200)
    const createdResource = await expectJson(
      app,
      '/resource-servers',
      'POST',
      {
        identifier: 'contacts',
        name: 'Contacts',
        resourceUrl: 'https://api.example.com',
      },
      201,
    )
    expect(createdResource.headers.get('location')).toBe('/api/resource-servers/resource-1')
    await expectJson(app, '/resource-servers/resource-1', 'GET', undefined, 200)
    await expectJson(app, '/resource-servers/resource-1/contract', 'GET', undefined, 200)
    await expectJson(app, '/resource-servers/resource-1', 'PATCH', { enabled: false }, 200)
    await expectJson(app, '/resource-servers/resource-1/archival', 'GET', undefined, 200)
    await expectJson(app, '/resource-servers/resource-1/archival', 'PUT', undefined, 200)
    await expectJson(app, '/resource-servers/resource-1/archival', 'DELETE', undefined, 200)
    await expectStatus(app, '/resource-servers/resource-1', 'DELETE', undefined, 204)
    await expectJson(app, '/organizations/org-1/roles', 'GET', undefined, 200)
    const createdAssignment = await expectJson(
      app,
      '/organizations/org-1/roles',
      'POST',
      {
        key: 'operator',
        displayName: 'Operator',
        description: null,
        scopes: [{ resourceId: 'resource-1', scope: 'contacts.read' }],
      },
      201,
    )
    expect(createdAssignment.headers.get('location')).toBe('/api/organizations/org-1/roles/operator')
    await expectJson(app, '/organizations/org-1/roles/operator', 'GET', undefined, 200)
    await expectJson(app, '/organizations/org-1/roles/operator', 'PATCH', { displayName: 'Operator 2' }, 200)
    await expectStatus(app, '/organizations/org-1/roles/operator', 'DELETE', undefined, 204)
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
  vi.spyOn(applicationsUsecase, 'listApplicationAuthorizations').mockImplementation((_d, query) =>
    applicationService.listAuthorizations(query),
  )
  vi.spyOn(applicationsUsecase, 'getApplicationAuthorization').mockImplementation((_d, authorizationId) =>
    applicationService.getAuthorization(authorizationId),
  )
  vi.spyOn(applicationsUsecase, 'putApplicationAuthorizationRevocation').mockImplementation((_d, authorizationId) =>
    applicationService.revokeAuthorization(authorizationId),
  )

  const { managementApplicationAuthorizationsRoute, managementApplicationsRoute } = await import(
    '@server/http/routes/management/applications'
  )
  const app = withAdminContext()
  app.route('/applications', managementApplicationsRoute)
  app.route('/application-authorizations', managementApplicationAuthorizationsRoute)
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
    connectorId: null,
    authorizationDetails: [],
    enabled: true,
    ownerOrganizationId: 'org-1',
    accessEligibility: { mode: 'realm' as const, organizationIds: [] },
    availableToAgents: true,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    authorization: null,
  }
  vi.spyOn(externalResourcesUsecase, 'listApiResources').mockResolvedValue({
    items: [apiResource],
    pagination: { limit: 50, offset: 0, total: 1, hasMore: false, nextOffset: null },
  })
  vi.spyOn(externalResourcesUsecase, 'getApiResource').mockResolvedValue(apiResource)
  vi.spyOn(authorizationUsecase, 'getResourceContract').mockResolvedValue({
    resourceId: apiResource.id,
    sourceUrl: 'https://api.example.com/openapi.json',
    scopes: [{ value: 'contacts:read', description: 'Read contacts' }],
    operations: [
      {
        method: 'GET',
        path: '/contacts',
        operationId: 'listContacts',
        summary: 'List contacts',
        description: null,
        requiredScopeSets: [['contacts:read']],
      },
    ],
  })
  const usecaseModule = authorizationUsecase as unknown as Record<string, (...args: unknown[]) => unknown>
  for (const name of Object.keys(authorizationService)) {
    const delegate = authorizationService[name as keyof typeof authorizationService] as (...a: unknown[]) => unknown
    vi.spyOn(usecaseModule, name).mockImplementation((_d: unknown, ...args: unknown[]) => delegate(...args))
  }
  vi.mocked(authorizationUsecase.archiveResource).mockResolvedValue(apiResource)
  vi.mocked(authorizationUsecase.restoreResource).mockResolvedValue(apiResource)

  const { createManagementApiResourcesRoute } = await import('@server/http/routes/management/api-resources')
  const { managementOrganizationsRoute } = await import('@server/http/routes/management/organizations')
  const { createProtectedResourceRoutes } = await import('@server/http/routes/management')
  const app = withAdminContext()
  app.route('/resource-servers', createManagementApiResourcesRoute())
  app.route('/organizations', managementOrganizationsRoute)
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
  return response
}

async function expectStatus(app: Hono, path: string, method: string, body: unknown, status: number) {
  const response = await request(app, path, method, body)
  expect(response.status, `${method} ${path}`).toBe(status)
}

function request(app: Hono, path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  })
}

function applicationServiceMock() {
  const application = {
    id: 'app-1',
    redirectUris: ['https://app.example.com/callback', 'https://next.example.com/callback'],
  }
  return {
    list: vi.fn().mockResolvedValue({
      applications: [application],
      pagination: { limit: 10, offset: 0, total: 1, hasMore: false, nextOffset: null },
    }),
    create: vi.fn().mockResolvedValue(application),
    get: vi.fn().mockResolvedValue(application),
    update: vi.fn().mockResolvedValue(application),
    delete: vi.fn().mockResolvedValue(undefined),
    replaceRedirectUris: vi
      .fn()
      .mockResolvedValue({ ...application, redirectUris: ['https://next.example.com/callback'] }),
    listSecrets: vi.fn().mockResolvedValue({
      secrets: [],
      pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
    }),
    rotateSecret: vi.fn().mockResolvedValue({ id: 'secret-1' }),
    listAuthorizations: vi.fn().mockResolvedValue({
      authorizations: [],
      pagination: { limit: 10, offset: 0, total: 0, hasMore: false, nextOffset: null },
    }),
    getAuthorization: vi.fn().mockResolvedValue({
      id: 'authorization-1',
      applicationId: 'app-1',
      user: { id: 'user-1', displayName: 'User', email: 'user@example.com' },
      organization: null,
      scopes: ['openid'],
      permissions: [],
      grantedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
      status: 'active',
    }),
    revokeAuthorization: vi.fn().mockResolvedValue({
      applicationAuthorizationId: 'authorization-1',
      revokedAt: '2026-08-01T00:00:00.000Z',
    }),
  }
}

function authorizationServiceMock() {
  const page = {
    items: [],
    pagination: { limit: 50, offset: 0, total: 0, hasMore: false, nextOffset: null },
  }
  const timestamp = '2026-08-01T00:00:00.000Z'
  const organization = {
    id: 'org-1',
    slug: 'acme',
    name: 'Acme',
    displayName: null,
    logo: null,
    disabled: false,
    disabledReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const member = {
    id: 'member-1',
    organizationId: 'org-1',
    userId: 'user-1',
    roles: ['member'],
    title: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const invitation = {
    id: 'invitation-1',
    organizationId: 'org-1',
    email: 'new@example.com',
    roles: ['member'],
    inviterId: 'admin-1',
    status: 'pending',
    expiresAt: '2026-08-03T00:00:00.000Z',
    acceptedAt: null,
    revokedAt: null,
    createdAt: timestamp,
  }
  const role = {
    key: 'operator',
    displayName: 'Operator',
    description: null,
    predefined: false,
    scopes: [{ resourceId: 'resource-1', scope: 'contacts.read' }],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return {
    listOrganizations: vi.fn().mockResolvedValue(page),
    createOrganization: vi.fn().mockResolvedValue(organization),
    getOrganization: vi.fn().mockResolvedValue(organization),
    updateOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }),
    deleteOrganization: vi.fn().mockResolvedValue(undefined),
    listMembers: vi.fn().mockResolvedValue(page),
    addMember: vi.fn().mockResolvedValue(member),
    updateMember: vi.fn().mockResolvedValue(member),
    removeMember: vi.fn().mockResolvedValue(undefined),
    listInvitations: vi.fn().mockResolvedValue(page),
    createInvitation: vi.fn().mockResolvedValue(invitation),
    cancelInvitation: vi.fn().mockResolvedValue(undefined),
    listResources: vi.fn().mockResolvedValue(page),
    createResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    getResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    updateResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    archiveResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    restoreResource: vi.fn().mockResolvedValue({ id: 'resource-1' }),
    deleteResource: vi.fn().mockResolvedValue(undefined),
    listRoles: vi.fn().mockResolvedValue({ roles: [role], pagination: page.pagination }),
    createRole: vi.fn().mockResolvedValue(role),
    getRole: vi.fn().mockResolvedValue(role),
    updateRole: vi.fn().mockResolvedValue(role),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    replaceMemberRoles: vi.fn().mockResolvedValue({
      roles: ['developer', 'member'],
    }),
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
    loginEnabled: true,
    clientId: 'client-id',
    clientSecretConfigured: true,
    issuer: null,
    authorizationEndpoint: null,
    tokenEndpoint: null,
    userInfoEndpoint: null,
    jwksEndpoint: null,
    registrationEndpoint: null,
    revocationEndpoint: null,
    registrationMode: null,
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
