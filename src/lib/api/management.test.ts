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
