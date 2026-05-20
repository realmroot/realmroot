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
    await management.getUser('user-1')
    await management.deleteUser('user-1')
    await management.requestPasswordReset('jane@example.com')
    await management.requestUserPasswordReset('user-1')
    await management.banUser('user-1', { reason: 'abuse', expiresInSeconds: 3600 })
    await management.unbanUser('user-1')
    await management.listUserSessions('user-1', { limit: 10, offset: 20 })
    await management.revokeUserSessions('user-1')
    await management.revokeUserSession('user-1', 'session-1')
    await management.listUserLinkedAccounts('user-1', { limit: 5 })
    await management.listUserApplications('user-1', { offset: 30 })
    await management.getUserSecurity('user-1')
    await management.listUserPasskeys('user-1', { limit: 2 })
    await management.deleteUserPasskey('user-1', 'passkey-1')
    await management.listConnectors()
    await management.createConnector({
      providerId: 'google',
      providerType: 'social',
      displayName: 'Google',
      clientId: 'google-client',
      clientSecretBinding: 'GOOGLE_SECRET',
    })
    await management.listConnectorTemplates()
    await management.getConnector('connector-1')
    await management.updateConnector('connector-1', { enabled: false })
    await management.getConnectorReadiness('connector-1')
    await management.deleteConnector('connector-1')
    await management.getSignInSettings()
    await management.updateSignInSettings({ signIn: { identifierFirst: true } })
    await management.getBrandingSettings()
    await management.updateBrandingSettings({ branding: { primaryColor: '#2563eb' } })
    await management.getAdminReadiness()
    await management.getSecurityPolicy()
    await management.updateSecurityPolicy({ policy: { mfa: { mode: 'required' } } })
    await management.listOrganizations()
    await management.createOrganization({ slug: 'acme', name: 'Acme' })
    await management.updateOrganization('org-1', { disabled: true })
    await management.uploadOrganizationLogo('org-1', new File(['logo'], 'logo.png'))
    await management.uploadBrandingLogo(new File(['logo'], 'logo.png'))
    await management.uploadBrandingFavicon(new File(['icon'], 'favicon.png'))
    await management.listRoles()
    await management.getRole('role-1')
    await management.createRole({ key: 'admin', name: 'Admin' })
    await management.updateRole('role-1', { description: 'Tenant admin' })
    await management.deleteRole('role-1')
    await management.listRolePermissions('role-1')
    await management.replaceRolePermissions('role-1', ['permission-1'])
    await management.assignUserRole({ roleId: 'role-1', subjectId: 'user-1' })
    await management.assignApplicationRole({ roleId: 'role-1', subjectId: 'app-1' })
    await management.assignMemberRole({ roleId: 'role-1', subjectId: 'member-1' })
    await management.listApiResources()
    await management.getApiResource('resource-1')
    await management.createApiResource({
      identifier: 'management-api',
      name: 'Management API',
      audience: 'https://auth.example.com/api/management',
    })
    await management.updateApiResource('resource-1', { enabled: false })
    await management.deleteApiResource('resource-1')
    await management.listApiScopes('resource-1')
    await management.createApiScope('resource-1', { value: 'orders:read' })
    await management.updateApiScope('resource-1', 'scope-1', { description: 'Read orders' })
    await management.deleteApiScope('resource-1', 'scope-1')
    await management.listApiPermissions('resource-1')
    await management.createApiPermission('resource-1', { key: 'orders.read' })
    await management.updateApiPermission('resource-1', 'permission-1', { key: 'orders.view' })
    await management.deleteApiPermission('resource-1', 'permission-1')

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
      ['user.get', { param: { id: 'user-1' } }],
      ['users.delete', { param: { id: 'user-1' } }],
      ['passwordReset.post', { json: { email: 'jane@example.com' } }],
      ['userPasswordReset.post', { param: { id: 'user-1' }, json: {} }],
      ['userBan.put', { param: { id: 'user-1' }, json: { reason: 'abuse', expiresInSeconds: 3600 } }],
      ['userBan.delete', { param: { id: 'user-1' } }],
      ['userSessions.get', { param: { id: 'user-1' }, query: { limit: '10', offset: '20' } }],
      ['userSessions.delete', { param: { id: 'user-1' } }],
      ['userSession.delete', { param: { id: 'user-1', sessionId: 'session-1' } }],
      ['userLinkedAccounts.get', { param: { id: 'user-1' }, query: { limit: '5' } }],
      ['userApplications.get', { param: { id: 'user-1' }, query: { offset: '30' } }],
      ['userSecurity.get', { param: { id: 'user-1' } }],
      ['userPasskeys.get', { param: { id: 'user-1' }, query: { limit: '2' } }],
      ['userPasskey.delete', { param: { id: 'user-1', passkeyId: 'passkey-1' } }],
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
      ['connectorTemplates.get'],
      ['connector.get', { param: { id: 'connector-1' } }],
      ['connectors.patch', { param: { id: 'connector-1' }, json: { enabled: false } }],
      ['connectorReadiness.get', { param: { id: 'connector-1' } }],
      ['connectors.delete', { param: { id: 'connector-1' } }],
      ['signIn.get'],
      ['signIn.patch', { json: { signIn: { identifierFirst: true } } }],
      ['branding.get'],
      ['branding.patch', { json: { branding: { primaryColor: '#2563eb' } } }],
      ['readiness.get'],
      ['security.get'],
      ['security.patch', { json: { policy: { mfa: { mode: 'required' } } } }],
      ['organizations.get'],
      ['organizations.post', { json: { slug: 'acme', name: 'Acme' } }],
      ['organizations.patch', { param: { id: 'org-1' }, json: { disabled: true } }],
      ['upload', '/api/management/organizations/org-1/logo', expect.any(File)],
      ['upload', '/api/management/branding/logo', expect.any(File)],
      ['upload', '/api/management/branding/favicon', expect.any(File)],
      ['roles.get'],
      ['role.get', { param: { id: 'role-1' } }],
      ['roles.post', { json: { key: 'admin', name: 'Admin' } }],
      ['roles.patch', { param: { id: 'role-1' }, json: { description: 'Tenant admin' } }],
      ['roles.delete', { param: { id: 'role-1' } }],
      ['rolePermissions.get', { param: { id: 'role-1' } }],
      ['rolePermissions.put', { param: { id: 'role-1' }, json: { permissionIds: ['permission-1'] } }],
      ['userRoleAssignments.post', { json: { roleId: 'role-1', subjectId: 'user-1' } }],
      ['applicationRoleAssignments.post', { json: { roleId: 'role-1', subjectId: 'app-1' } }],
      ['memberRoleAssignments.post', { json: { roleId: 'role-1', subjectId: 'member-1' } }],
      ['apiResources.get'],
      ['apiResource.get', { param: { id: 'resource-1' } }],
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
      ['apiResources.delete', { param: { id: 'resource-1' } }],
      ['apiScopes.get', { param: { id: 'resource-1' } }],
      ['apiScopes.post', { param: { id: 'resource-1' }, json: { value: 'orders:read' } }],
      ['apiScopes.patch', { param: { id: 'resource-1', scopeId: 'scope-1' }, json: { description: 'Read orders' } }],
      ['apiScopes.delete', { param: { id: 'resource-1', scopeId: 'scope-1' } }],
      ['apiPermissions.get', { param: { id: 'resource-1' } }],
      ['apiPermissions.post', { param: { id: 'resource-1' }, json: { key: 'orders.read' } }],
      [
        'apiPermissions.patch',
        { param: { id: 'resource-1', permissionId: 'permission-1' }, json: { key: 'orders.view' } },
      ],
      ['apiPermissions.delete', { param: { id: 'resource-1', permissionId: 'permission-1' } }],
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
})

async function loadManagementApi() {
  const calls: Array<[string, unknown?, unknown?]> = []
  const endpoint = (key: string) =>
    vi.fn((input?: unknown) => {
      calls.push(input === undefined ? [key] : [key, input])
      return Promise.resolve({ key, input })
    })

  vi.doMock('@/lib/api', () => ({
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
            ':id': {
              $get: endpoint('user.get'),
              $patch: endpoint('users.patch'),
              $delete: endpoint('users.delete'),
              'password-reset-requests': { $post: endpoint('userPasswordReset.post') },
              ban: {
                $put: endpoint('userBan.put'),
                $delete: endpoint('userBan.delete'),
              },
              sessions: {
                $get: endpoint('userSessions.get'),
                $delete: endpoint('userSessions.delete'),
                ':sessionId': { $delete: endpoint('userSession.delete') },
              },
              'linked-accounts': { $get: endpoint('userLinkedAccounts.get') },
              applications: { $get: endpoint('userApplications.get') },
              security: { $get: endpoint('userSecurity.get') },
              passkeys: {
                $get: endpoint('userPasskeys.get'),
                ':passkeyId': { $delete: endpoint('userPasskey.delete') },
              },
            },
            'password-reset-requests': { $post: endpoint('passwordReset.post') },
          },
          connectors: {
            $get: endpoint('connectors.get'),
            $post: endpoint('connectors.post'),
            templates: { $get: endpoint('connectorTemplates.get') },
            ':id': {
              $get: endpoint('connector.get'),
              $patch: endpoint('connectors.patch'),
              $delete: endpoint('connectors.delete'),
              readiness: { $get: endpoint('connectorReadiness.get') },
            },
          },
          'sign-in-settings': { $get: endpoint('signIn.get'), $patch: endpoint('signIn.patch') },
          'branding-settings': { $get: endpoint('branding.get'), $patch: endpoint('branding.patch') },
          readiness: { $get: endpoint('readiness.get') },
          security: { policy: { $get: endpoint('security.get'), $patch: endpoint('security.patch') } },
          organizations: {
            $get: endpoint('organizations.get'),
            $post: endpoint('organizations.post'),
            ':id': { $patch: endpoint('organizations.patch') },
          },
          roles: {
            $get: endpoint('roles.get'),
            $post: endpoint('roles.post'),
            ':id': {
              $get: endpoint('role.get'),
              $patch: endpoint('roles.patch'),
              $delete: endpoint('roles.delete'),
              permissions: {
                $get: endpoint('rolePermissions.get'),
                $put: endpoint('rolePermissions.put'),
              },
            },
          },
          'user-role-assignments': { $post: endpoint('userRoleAssignments.post') },
          'application-role-assignments': { $post: endpoint('applicationRoleAssignments.post') },
          'member-role-assignments': { $post: endpoint('memberRoleAssignments.post') },
          'api-resources': {
            $get: endpoint('apiResources.get'),
            $post: endpoint('apiResources.post'),
            ':id': {
              $get: endpoint('apiResource.get'),
              $patch: endpoint('apiResources.patch'),
              $delete: endpoint('apiResources.delete'),
              scopes: {
                $get: endpoint('apiScopes.get'),
                $post: endpoint('apiScopes.post'),
                ':scopeId': {
                  $patch: endpoint('apiScopes.patch'),
                  $delete: endpoint('apiScopes.delete'),
                },
              },
              permissions: {
                $get: endpoint('apiPermissions.get'),
                $post: endpoint('apiPermissions.post'),
                ':permissionId': {
                  $patch: endpoint('apiPermissions.patch'),
                  $delete: endpoint('apiPermissions.delete'),
                },
              },
            },
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
