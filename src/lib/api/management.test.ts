import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('management API client', () => {
  it('maps management resource helpers to the Hono RPC boundary', async () => {
    const { calls, management } = await loadManagementApi()

    await management.listApplications()
    await management.createApplication({ name: 'Portal', clientType: 'public_spa', redirectUris: [] })
    await management.getApplication('app-1')
    await management.updateApplication('app-1', { disabled: true })
    await management.deleteApplication('app-1')
    await management.listApplicationRedirectUris('app-1', { limit: 10, offset: 20 })
    await management.replaceApplicationRedirectUris('app-1', { redirectUris: ['https://app.example.com/callback'] })
    await management.listApplicationClientSecrets('app-1', { limit: 5 })
    await management.rotateApplicationClientSecret('app-1')
    await management.uploadApplicationLogo('app-1', new File(['logo'], 'logo.png'))
    await management.listUsers({ search: 'jane', limit: 50, offset: undefined })
    await management.createUser({ email: 'jane@example.com', displayName: 'Jane Doe' })
    await management.updateUser('user-1', { role: 'admin' })
    await management.requestPasswordReset('jane@example.com')
    await management.listConnectors()
    await management.createConnector({
      providerId: 'google',
      providerType: 'social',
      displayName: 'Google',
      clientId: 'google-client',
      clientSecretBinding: 'GOOGLE_SECRET',
    })
    await management.updateConnector('connector-1', { enabled: false })
    await management.getSignInSettings()
    await management.updateSignInSettings({ signIn: { identifierFirst: true } })
    await management.getBrandingSettings()
    await management.updateBrandingSettings({ branding: { primaryColor: '#2563eb' } })
    await management.getAdminReadiness()
    await management.getSecurityPolicy()
    await management.listOrganizations()
    await management.createOrganization({ slug: 'acme', name: 'Acme' })
    await management.updateOrganization('org-1', { disabled: true })
    await management.uploadOrganizationLogo('org-1', new File(['logo'], 'logo.png'))
    await management.uploadBrandingLogo(new File(['logo'], 'logo.png'))
    await management.uploadBrandingFavicon(new File(['icon'], 'favicon.png'))
    await management.listRoles()
    await management.createRole({ key: 'admin', name: 'Admin' })
    await management.updateRole('role-1', { description: 'Tenant admin' })
    await management.listApiResources()
    await management.createApiResource({
      identifier: 'management-api',
      name: 'Management API',
      audience: 'https://auth.example.com/api/management',
    })
    await management.updateApiResource('resource-1', { enabled: false })

    expect(calls).toEqual([
      ['applications.get'],
      ['applications.post', { json: { name: 'Portal', clientType: 'public_spa', redirectUris: [] } }],
      ['application.get', { param: { id: 'app-1' } }],
      ['applications.patch', { param: { id: 'app-1' }, json: { disabled: true } }],
      ['applications.delete', { param: { id: 'app-1' } }],
      ['redirectUris.get', { param: { id: 'app-1' }, query: { limit: '10', offset: '20' } }],
      ['redirectUris.put', { param: { id: 'app-1' }, json: { redirectUris: ['https://app.example.com/callback'] } }],
      ['clientSecrets.get', { param: { id: 'app-1' }, query: { limit: '5' } }],
      ['clientSecrets.post', { param: { id: 'app-1' } }],
      ['upload', '/api/management/applications/app-1/logo', expect.any(File)],
      ['users.get', { query: { search: 'jane', limit: '50' } }],
      ['users.post', { json: { email: 'jane@example.com', displayName: 'Jane Doe' } }],
      ['users.patch', { param: { id: 'user-1' }, json: { role: 'admin' } }],
      ['passwordReset.post', { json: { email: 'jane@example.com' } }],
      ['connectors.get'],
      [
        'connectors.post',
        {
          json: {
            providerId: 'google',
            providerType: 'social',
            displayName: 'Google',
            clientId: 'google-client',
            clientSecretBinding: 'GOOGLE_SECRET',
          },
        },
      ],
      ['connectors.patch', { param: { id: 'connector-1' }, json: { enabled: false } }],
      ['signIn.get'],
      ['signIn.patch', { json: { signIn: { identifierFirst: true } } }],
      ['branding.get'],
      ['branding.patch', { json: { branding: { primaryColor: '#2563eb' } } }],
      ['readiness.get'],
      ['security.get'],
      ['organizations.get'],
      ['organizations.post', { json: { slug: 'acme', name: 'Acme' } }],
      ['organizations.patch', { param: { id: 'org-1' }, json: { disabled: true } }],
      ['upload', '/api/management/organizations/org-1/logo', expect.any(File)],
      ['upload', '/api/management/branding/logo', expect.any(File)],
      ['upload', '/api/management/branding/favicon', expect.any(File)],
      ['roles.get'],
      ['roles.post', { json: { key: 'admin', name: 'Admin' } }],
      ['roles.patch', { param: { id: 'role-1' }, json: { description: 'Tenant admin' } }],
      ['apiResources.get'],
      [
        'apiResources.post',
        {
          json: {
            identifier: 'management-api',
            name: 'Management API',
            audience: 'https://auth.example.com/api/management',
          },
        },
      ],
      ['apiResources.patch', { param: { id: 'resource-1' }, json: { enabled: false } }],
    ])
  })

  it('composes the dashboard from all management resources', async () => {
    const { management } = await loadManagementApi()

    await expect(management.getAdminDashboard()).resolves.toMatchObject({
      applications: { key: 'applications.get' },
      users: { key: 'users.get' },
      connectors: { key: 'connectors.get' },
      organizations: { key: 'organizations.get' },
      roles: { key: 'roles.get' },
      apiResources: { key: 'apiResources.get' },
      signIn: { key: 'signIn.get' },
      security: { key: 'security.get' },
    })
  })

  it('maps fetch-based authorization helpers and response handling', async () => {
    const fetchCalls: Array<{ path: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        fetchCalls.push({ path, init })
        if (path.includes('/empty-error/')) return Promise.resolve(new Response('', { status: 500 }))
        if (path.includes('/string-error/')) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'String failure.' }), { status: 400 }))
        }
        if (path.includes('/object-error/')) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { message: 'Object failure.' } }), { status: 400 }),
          )
        }
        if (path.includes('/message-error/')) {
          return Promise.resolve(new Response(JSON.stringify({ message: 'Message failure.' }), { status: 400 }))
        }
        if (path.includes('/text-error/')) {
          return Promise.resolve(new Response('Text failure.', { status: 400 }))
        }
        if (init?.method === 'DELETE' || path.includes('assignments')) {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }),
    )
    const { management } = await loadManagementApi()

    await management.getRole('role-1')
    await management.deleteRole('role-1')
    await management.listRolePermissions('role-1')
    await management.replaceRolePermissions('role-1', ['permission-1'])
    await management.assignUserRole({ roleId: 'role-1', subjectId: 'user-1' })
    await management.assignApplicationRole({ roleId: 'role-1', subjectId: 'app-1' })
    await management.assignMemberRole({ roleId: 'role-1', subjectId: 'member-1' })
    await management.getApiResource('resource-1')
    await management.deleteApiResource('resource-1')
    await management.listApiScopes('resource-1')
    await management.createApiScope('resource-1', { value: 'orders:read' })
    await management.updateApiScope('resource-1', 'scope-1', { description: 'Read orders' })
    await management.deleteApiScope('resource-1', 'scope-1')
    await management.listApiPermissions('resource-1')
    await management.createApiPermission('resource-1', { key: 'orders.read' })
    await management.updateApiPermission('resource-1', 'permission-1', { key: 'orders.view' })
    await management.deleteApiPermission('resource-1', 'permission-1')

    expect(fetchCalls.map((call) => [call.path, call.init?.method ?? 'GET', call.init?.body])).toEqual([
      ['/api/management/roles/role-1', 'GET', undefined],
      ['/api/management/roles/role-1', 'DELETE', undefined],
      ['/api/management/roles/role-1/permissions', 'GET', undefined],
      ['/api/management/roles/role-1/permissions', 'PUT', JSON.stringify({ permissionIds: ['permission-1'] })],
      ['/api/management/user-role-assignments', 'POST', JSON.stringify({ roleId: 'role-1', subjectId: 'user-1' })],
      [
        '/api/management/application-role-assignments',
        'POST',
        JSON.stringify({ roleId: 'role-1', subjectId: 'app-1' }),
      ],
      ['/api/management/member-role-assignments', 'POST', JSON.stringify({ roleId: 'role-1', subjectId: 'member-1' })],
      ['/api/management/api-resources/resource-1', 'GET', undefined],
      ['/api/management/api-resources/resource-1', 'DELETE', undefined],
      ['/api/management/api-resources/resource-1/scopes', 'GET', undefined],
      ['/api/management/api-resources/resource-1/scopes', 'POST', JSON.stringify({ value: 'orders:read' })],
      [
        '/api/management/api-resources/resource-1/scopes/scope-1',
        'PATCH',
        JSON.stringify({ description: 'Read orders' }),
      ],
      ['/api/management/api-resources/resource-1/scopes/scope-1', 'DELETE', undefined],
      ['/api/management/api-resources/resource-1/permissions', 'GET', undefined],
      ['/api/management/api-resources/resource-1/permissions', 'POST', JSON.stringify({ key: 'orders.read' })],
      [
        '/api/management/api-resources/resource-1/permissions/permission-1',
        'PATCH',
        JSON.stringify({ key: 'orders.view' }),
      ],
      ['/api/management/api-resources/resource-1/permissions/permission-1', 'DELETE', undefined],
    ])

    await expect(management.listApiScopes('empty-error')).rejects.toThrow('Request failed with status 500.')
    await expect(management.listApiScopes('string-error')).rejects.toThrow('String failure.')
    await expect(management.listApiScopes('object-error')).rejects.toThrow('Object failure.')
    await expect(management.listApiScopes('message-error')).rejects.toThrow('Message failure.')
    await expect(management.listApiScopes('text-error')).rejects.toThrow('Text failure.')
  })
})

async function loadManagementApi() {
  const calls: Array<[string, unknown?, unknown?]> = []
  const endpoint = (key: string) =>
    vi.fn((input?: unknown) => {
      calls.push(input === undefined ? [key] : [key, input])
      return Promise.resolve({ key, input })
    })

  vi.doMock('@/lib/api', () => ({
    ApiRequestError: class ApiRequestError extends Error {
      constructor(
        message: string,
        readonly status: number,
      ) {
        super(message)
      }
    },
    apiClient: {
      api: {
        management: {
          applications: {
            $get: endpoint('applications.get'),
            $post: endpoint('applications.post'),
            ':id': {
              $get: endpoint('application.get'),
              $patch: endpoint('applications.patch'),
              $delete: endpoint('applications.delete'),
              'redirect-uris': {
                $get: endpoint('redirectUris.get'),
                $put: endpoint('redirectUris.put'),
              },
              'client-secrets': {
                $get: endpoint('clientSecrets.get'),
                $post: endpoint('clientSecrets.post'),
              },
            },
          },
          users: {
            $get: endpoint('users.get'),
            $post: endpoint('users.post'),
            ':id': { $patch: endpoint('users.patch') },
            'password-reset-requests': { $post: endpoint('passwordReset.post') },
          },
          connectors: {
            $get: endpoint('connectors.get'),
            $post: endpoint('connectors.post'),
            ':id': { $patch: endpoint('connectors.patch') },
          },
          'sign-in-settings': { $get: endpoint('signIn.get'), $patch: endpoint('signIn.patch') },
          'branding-settings': { $get: endpoint('branding.get'), $patch: endpoint('branding.patch') },
          readiness: { $get: endpoint('readiness.get') },
          security: { policy: { $get: endpoint('security.get') } },
          organizations: {
            $get: endpoint('organizations.get'),
            $post: endpoint('organizations.post'),
            ':id': { $patch: endpoint('organizations.patch') },
          },
          roles: {
            $get: endpoint('roles.get'),
            $post: endpoint('roles.post'),
            ':id': { $patch: endpoint('roles.patch') },
          },
          'api-resources': {
            $get: endpoint('apiResources.get'),
            $post: endpoint('apiResources.post'),
            ':id': { $patch: endpoint('apiResources.patch') },
          },
        },
      },
    },
    readRpcResponse: (response: unknown) => response,
    uploadApiFile: (path: string, file: File) => {
      calls.push(['upload', path, file])
      return Promise.resolve({ asset: { publicUrl: `/uploaded/${file.name}` } })
    },
  }))

  return {
    calls,
    management: await import('./management'),
  }
}
