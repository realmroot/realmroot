import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('admin resource routes', () => {
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

  it('routes API resource, scope, permission, role, and assignment requests', async () => {
    const { app, authorizationService } = await loadAuthorizationRoutes()

    await expectJson(app, '/api-resources', 'GET', undefined, 200)
    await expectJson(
      app,
      '/api-resources',
      'POST',
      { identifier: 'contacts', name: 'Contacts', audience: 'https://api.example.com' },
      201,
    )
    await expectJson(app, '/api-resources/resource-1', 'GET', undefined, 200)
    await expectJson(app, '/api-resources/resource-1', 'PATCH', { enabled: false }, 200)
    await expectStatus(app, '/api-resources/resource-1', 'DELETE', undefined, 204)
    await expectJson(app, '/api-resources/resource-1/scopes', 'GET', undefined, 200)
    await expectJson(app, '/api-resources/resource-1/scopes', 'POST', { value: 'contacts.read' }, 201)
    await expectJson(app, '/api-resources/resource-1/scopes/scope-1', 'PATCH', { required: true }, 200)
    await expectStatus(app, '/api-resources/resource-1/scopes/scope-1', 'DELETE', undefined, 204)
    await expectJson(app, '/api-resources/resource-1/permissions', 'GET', undefined, 200)
    await expectJson(app, '/api-resources/resource-1/permissions', 'POST', { key: 'contacts.read' }, 201)
    await expectJson(app, '/api-resources/resource-1/permissions/permission-1', 'PATCH', { key: 'contacts.view' }, 200)
    await expectStatus(app, '/api-resources/resource-1/permissions/permission-1', 'DELETE', undefined, 204)

    await expectJson(app, '/roles', 'GET', undefined, 200)
    await expectJson(app, '/roles', 'POST', { key: 'admin', name: 'Admin' }, 201)
    await expectJson(app, '/roles/role-1', 'GET', undefined, 200)
    await expectJson(app, '/roles/role-1', 'PATCH', { name: 'Owner' }, 200)
    await expectStatus(app, '/roles/role-1', 'DELETE', undefined, 204)
    await expectStatus(app, '/roles/role-1/permissions', 'PUT', { permissionIds: ['permission-1'] }, 204)
    await expectStatus(app, '/roles/assignments/users', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/roles/assignments/applications', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/roles/assignments/members', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/user-role-assignments', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/application-role-assignments', 'POST', assignmentBody(), 204)
    await expectStatus(app, '/member-role-assignments', 'POST', assignmentBody(), 204)

    expect(authorizationService.replaceRolePermissions).toHaveBeenCalledWith('role-1', ['permission-1'])
    expect(authorizationService.assignUserRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
    expect(authorizationService.assignApplicationRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
    expect(authorizationService.assignMemberRole).toHaveBeenCalledWith(assignmentBody(), 'admin-1')
  })

  it('routes admin connector requests to the connector service', async () => {
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
        clientSecretBinding: 'GITHUB_SECRET',
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
      clientSecretBinding: 'GITHUB_SECRET',
    })
    expect(connectorService.update).toHaveBeenCalledWith('connector-1', { enabled: false })
    expect(connectorService.delete).toHaveBeenCalledWith('connector-1')
  })
})

async function loadAppRoutes() {
  const applicationService = applicationServiceMock()
  vi.doMock('../modules/applications/context', () => ({
    createApplicationService: () => applicationService,
  }))
  const { adminApplicationsRoute } = await import('./admin/applications')
  const app = withAdminContext()
  app.route('/applications', adminApplicationsRoute)
  return { app, applicationService }
}

async function loadAuthorizationRoutes() {
  const authorizationService = authorizationServiceMock()
  vi.doMock('../modules/authorization/context', () => ({
    createAuthorizationService: () => authorizationService,
  }))
  const { adminApiResourcesRoute } = await import('./admin/api-resources')
  const { adminOrganizationsRoute } = await import('./admin/organizations')
  const { adminRolesRoute } = await import('./admin/roles')
  const { createManagementRoutes } = await import('./management')
  const app = withAdminContext()
  app.route('/api-resources', adminApiResourcesRoute)
  app.route('/organizations', adminOrganizationsRoute)
  app.route('/roles', adminRolesRoute)
  app.route('/', createManagementRoutes({ authApi: {} as never }))
  return { app, authorizationService }
}

async function loadConnectorRoutes() {
  const connectorService = connectorServiceMock()
  vi.doMock('../modules/connectors/context', () => ({
    createConnectorService: () => connectorService,
  }))
  const { adminConnectorsRoute } = await import('./admin/connectors')
  const app = withAdminContext()
  app.route('/connectors', adminConnectorsRoute)
  return { app, connectorService }
}

function withAdminContext() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('authContext', {
      session: { session: { id: 'session-1' }, user: { id: 'admin-1', role: 'admin' } },
      user: { id: 'admin-1', role: 'admin' },
    })
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
    listScopes: vi.fn().mockResolvedValue(page),
    createScope: vi.fn().mockResolvedValue({ id: 'scope-1' }),
    updateScope: vi.fn().mockResolvedValue({ id: 'scope-1' }),
    deleteScope: vi.fn().mockResolvedValue(undefined),
    listPermissions: vi.fn().mockResolvedValue(page),
    createPermission: vi.fn().mockResolvedValue({ id: 'permission-1' }),
    updatePermission: vi.fn().mockResolvedValue({ id: 'permission-1' }),
    deletePermission: vi.fn().mockResolvedValue(undefined),
    listRoles: vi.fn().mockResolvedValue(page),
    createRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
    getRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
    updateRole: vi.fn().mockResolvedValue({ id: 'role-1' }),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    replaceRolePermissions: vi.fn().mockResolvedValue(undefined),
    assignUserRole: vi.fn().mockResolvedValue(undefined),
    assignApplicationRole: vi.fn().mockResolvedValue(undefined),
    assignMemberRole: vi.fn().mockResolvedValue(undefined),
  }
}

function connectorServiceMock() {
  const connector = { id: 'connector-1', providerId: 'github', displayName: 'GitHub' }
  return {
    listTemplates: vi.fn().mockReturnValue([{ providerId: 'github', displayName: 'GitHub' }]),
    list: vi.fn().mockResolvedValue({ connectors: [connector], pagination: { limit: 10, offset: 0, total: 1 } }),
    create: vi.fn().mockResolvedValue(connector),
    get: vi.fn().mockResolvedValue(connector),
    update: vi.fn().mockResolvedValue({ ...connector, enabled: false }),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

function assignmentBody() {
  return { roleId: 'role-1', subjectId: 'subject-1' }
}
