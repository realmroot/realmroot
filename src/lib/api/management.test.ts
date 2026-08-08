import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('management API client', () => {
  it('reads user security and exposes remaining management wrappers', async () => {
    const { calls, management } = await loadManagementApi({ userSecurity: { mfaEnabled: true } })

    await expect(management.getUserSecurity('user-1')).resolves.toEqual({ security: { mfaEnabled: true } })
    await management.listWebhookDeliveryAttempts('wh-1', 'delivery-1', { limit: 10 })
    await management.addOrganizationMember('org/1', { userId: 'user-1', roles: ['member'] })

    expect(calls).toEqual([
      ['user.get', { param: { id: 'user-1' } }],
      ['webhookDeliveryAttempts.get', { param: { id: 'wh-1', deliveryId: 'delivery-1' }, query: { limit: '10' } }],
      [
        'fetch',
        '/api/organizations/org%2F1/members',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: 'user-1', roles: ['member'] }),
        },
      ],
    ])
  })

  it('rejects user security reads outside Realm authority', async () => {
    const { management } = await loadManagementApi({ userSecurity: null })
    await expect(management.getUserSecurity('user-1')).rejects.toThrow('require Realm-level access')
  })

  it('maps management resource helpers to the Hono RPC boundary', async () => {
    const { calls, management } = await loadManagementApi()

    await management.listApplications()
    await management.createApplication({
      name: 'Portal',
      clientType: 'public_spa',
      redirectUris: [],
      ownerOrganizationId: 'org-1',
    })
    await management.getApplication('app-1')
    await management.updateApplication('app-1', {
      disabled: true,
      oidcClaims: {
        accessToken: { authorization: true, roles: true, groups: true, organizationId: true },
        idToken: { roles: true },
        userInfo: { organizationName: true },
      },
    })
    await management.deleteApplication('app-1')
    await management.listFederatedCredentials('app-1')
    await management.createFederatedCredential('app-1', {
      name: 'Runner workload',
      issuer: 'https://platform.example.com',
      subject: 'org_1:*',
      audienceResourceId: 'resource-1',
      jwksUrl: 'https://platform.example.com/jwks',
    })
    await management.updateFederatedCredential('app-1', 'cred-1', { enabled: false })
    await management.deleteFederatedCredential('app-1', 'cred-1')
    await management.listApplicationRedirectUris('app-1', { limit: 10, offset: 20 })
    await management.replaceApplicationRedirectUris('app-1', { redirectUris: ['https://app.example.com/callback'] })
    await management.listApplicationClientSecrets('app-1', { limit: 5 })
    await management.rotateApplicationClientSecret('app-1')
    await management.listApplicationAuthorizations({ applicationId: 'app-1', limit: 25, offset: 50 })
    await management.revokeApplicationAuthorization('authorization-1')
    await management.uploadApplicationLogo('app-1', new File(['logo'], 'logo.png'))
    await management.listUsers({ search: 'jane', limit: 50, offset: undefined })
    await management.createUser({ email: 'jane@example.com', displayName: 'Jane Doe' })
    await management.updateUser('user-1', { displayName: 'Jane Admin' })
    await management.getUser('user-1')
    await management.deleteUser('user-1')
    await management.requestUserPasswordReset('user-1')
    await management.banUser('user-1', { reason: 'abuse', expiresInSeconds: 3600 })
    await management.unbanUser('user-1')
    await management.listUserSessions('user-1', { limit: 10, offset: 20 })
    await management.revokeUserSessions('user-1')
    await management.revokeUserSession('user-1', 'session-1')
    await management.listUserLinkedAccounts('user-1', { limit: 5 })
    await management.listUserPasskeys('user-1', { limit: 2 })
    await management.deleteUserPasskey('user-1', 'passkey-1')
    await management.listConnectors()
    await management.createConnector({
      providerId: 'google',
      providerType: 'social',
      displayName: 'Google',
      clientId: 'google-client',
      clientSecret: 'GOOGLE_SECRET',
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
    await management.getAgentInventory()
    await management.deleteAgent('agent-1')
    await management.getSecurityPolicy()
    await management.updateSecurityPolicy({ policy: { mfa: { mode: 'required' } } })
    await management.listOrganizations()
    await management.createOrganization({ slug: 'acme', name: 'Acme' })
    await management.updateOrganization('org-1', { disabled: true })
    await management.updateOrganizationMember('org-1', 'member-1', { title: 'Staff engineer' })
    await management.uploadOrganizationLogo('org-1', new File(['logo'], 'logo.png'))
    await management.uploadBrandingLogo(new File(['logo'], 'logo.png'))
    await management.uploadBrandingFavicon(new File(['icon'], 'favicon.png'))
    await management.listRoles('org-1')
    await management.getRole('org-1', 'operator')
    await management.createRole('org-1', {
      key: 'operator',
      displayName: 'Operator',
      description: null,
      scopes: [{ resourceId: 'resource-1', scope: 'orders.read' }],
    })
    await management.updateRole('org-1', 'operator', { description: 'Tenant operator' })
    await management.deleteRole('org-1', 'operator')
    await management.getOrganizationMemberRoles('org-1', 'member-1')
    await management.replaceOrganizationMemberRoles('org-1', 'member-1', { roles: ['developer', 'member'] })
    await management.listApiResources()
    await management.listApiResources({ ownerOrganizationId: 'org-1' })
    await management.getApiResource('resource-1')
    await management.createApiResource({
      identifier: 'management-api',
      resourceUrl: 'https://auth.example.com/api',
      accessMode: 'realmroot',
      ownerOrganizationId: 'org-1',
    })
    await management.updateApiResource('resource-1', { enabled: false })
    await management.deleteApiResource('resource-1')
    await management.listWebhookEndpoints({ search: 'auth', status: 'enabled' })
    await management.createWebhookEndpoint({
      url: 'https://app.example.com/webhooks/auth',
      events: ['user.created'],
      enabled: true,
      organizationId: null,
    })
    await management.updateWebhookEndpoint('wh_1', { enabled: false })
    await management.deleteWebhookEndpoint('wh_1')
    await management.rotateWebhookEndpointSecret('wh_1')
    await management.listWebhookRequests({ endpointId: 'wh_1', status: 'failed' })
    await management.getWebhookRequest('wh_1', 'whr_1')
    await management.createWebhookDeliveryAttempt('wh_1', 'whr_1', 'retry-whr-1')

    expect(calls).toEqual([
      ['applications.get'],
      [
        'applications.post',
        {
          json: {
            name: 'Portal',
            clientType: 'public_spa',
            redirectUris: [],
            ownerOrganizationId: 'org-1',
          },
        },
      ],
      ['application.get', { param: { id: 'app-1' } }],
      [
        'applications.patch',
        {
          param: { id: 'app-1' },
          json: {
            disabled: true,
            oidcClaims: {
              accessToken: { authorization: true, roles: true, groups: true, organizationId: true },
              idToken: { roles: true },
              userInfo: { organizationName: true },
            },
          },
        },
      ],
      ['applications.delete', { param: { id: 'app-1' } }],
      ['federatedCredentials.get', { param: { applicationId: 'app-1' } }],
      [
        'federatedCredentials.post',
        {
          param: { applicationId: 'app-1' },
          json: {
            name: 'Runner workload',
            issuer: 'https://platform.example.com',
            subject: 'org_1:*',
            audienceResourceId: 'resource-1',
            jwksUrl: 'https://platform.example.com/jwks',
          },
        },
      ],
      [
        'federatedCredential.patch',
        { param: { applicationId: 'app-1', credentialId: 'cred-1' }, json: { enabled: false } },
      ],
      ['federatedCredential.delete', { param: { applicationId: 'app-1', credentialId: 'cred-1' } }],
      ['redirectUris.get', { param: { id: 'app-1' }, query: { limit: '10', offset: '20' } }],
      ['redirectUris.put', { param: { id: 'app-1' }, json: { redirectUris: ['https://app.example.com/callback'] } }],
      ['clientSecrets.get', { param: { id: 'app-1' }, query: { limit: '5' } }],
      ['clientSecrets.post', { param: { id: 'app-1' } }],
      ['applicationAuthorizations.get', { query: { applicationId: 'app-1', limit: '25', offset: '50' } }],
      ['applicationAuthorizationRevocation.put', { param: { authorizationId: 'authorization-1' } }],
      ['uploadAsset', 'application_logo', expect.any(File)],
      ['applications.patch', { param: { id: 'app-1' }, json: { iconUrl: '/api/assets/asset-1' } }],
      ['users.get', { query: { search: 'jane', limit: '50' } }],
      ['users.post', { json: { email: 'jane@example.com', displayName: 'Jane Doe' } }],
      ['users.patch', { param: { id: 'user-1' }, json: { displayName: 'Jane Admin' } }],
      ['user.get', { param: { id: 'user-1' } }],
      ['users.delete', { param: { id: 'user-1' } }],
      ['userPasswordReset.post', { param: { id: 'user-1' }, json: {} }],
      ['userBan.put', { param: { id: 'user-1' }, json: { reason: 'abuse', expiresInSeconds: 3600 } }],
      ['userBan.delete', { param: { id: 'user-1' } }],
      ['userSessions.get', { param: { id: 'user-1' }, query: { limit: '10', offset: '20' } }],
      ['userSessions.delete', { param: { id: 'user-1' } }],
      ['userSession.delete', { param: { id: 'user-1', sessionId: 'session-1' } }],
      ['userLinkedAccounts.get', { param: { id: 'user-1' }, query: { limit: '5' } }],
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
            clientSecret: 'GOOGLE_SECRET',
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
      ['agentInventory.get'],
      ['agent.delete', { param: { agentId: 'agent-1' } }],
      ['security.get'],
      ['security.patch', { json: { policy: { mfa: { mode: 'required' } } } }],
      ['organizations.get'],
      ['organizations.post', { json: { slug: 'acme', name: 'Acme' } }],
      ['organizations.patch', { param: { id: 'org-1' }, json: { disabled: true } }],
      [
        'fetch',
        '/api/organizations/org-1/members/member-1',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Staff engineer' }),
        },
      ],
      ['uploadAsset', 'organization_logo', expect.any(File)],
      ['organizations.patch', { param: { id: 'org-1' }, json: { logo: '/api/assets/asset-1' } }],
      ['uploadAsset', 'branding_logo', expect.any(File)],
      ['branding.patch', { json: { branding: { logoUrl: '/api/assets/asset-1' } } }],
      ['uploadAsset', 'favicon', expect.any(File)],
      ['branding.patch', { json: { branding: { faviconUrl: '/api/assets/asset-1' } } }],
      ['organizationRoles.get', { param: { organizationId: 'org-1' } }],
      ['organizationRole.get', { param: { organizationId: 'org-1', roleKey: 'operator' } }],
      [
        'organizationRoles.post',
        {
          param: { organizationId: 'org-1' },
          json: {
            key: 'operator',
            displayName: 'Operator',
            description: null,
            scopes: [{ resourceId: 'resource-1', scope: 'orders.read' }],
          },
        },
      ],
      [
        'organizationRole.patch',
        {
          param: { organizationId: 'org-1', roleKey: 'operator' },
          json: { description: 'Tenant operator' },
        },
      ],
      ['organizationRole.delete', { param: { organizationId: 'org-1', roleKey: 'operator' } }],
      ['memberRoles.get', { param: { organizationId: 'org-1', memberId: 'member-1' } }],
      [
        'memberRoles.put',
        {
          param: { organizationId: 'org-1', memberId: 'member-1' },
          json: { roles: ['developer', 'member'] },
        },
      ],
      ['apiResources.get'],
      ['apiResources.get', { query: { ownerOrganizationId: 'org-1' } }],
      ['apiResource.get', { param: { id: 'resource-1' } }],
      [
        'apiResources.post',
        {
          json: {
            identifier: 'management-api',
            resourceUrl: 'https://auth.example.com/api',
            accessMode: 'realmroot',
            ownerOrganizationId: 'org-1',
          },
        },
      ],
      ['apiResources.patch', { param: { id: 'resource-1' }, json: { enabled: false } }],
      ['apiResources.delete', { param: { id: 'resource-1' } }],
      ['webhookEndpoints.get', { query: { search: 'auth', status: 'enabled' } }],
      [
        'webhookEndpoints.post',
        {
          json: {
            url: 'https://app.example.com/webhooks/auth',
            events: ['user.created'],
            enabled: true,
            organizationId: null,
          },
        },
      ],
      ['webhookEndpoint.patch', { param: { id: 'wh_1' }, json: { enabled: false } }],
      ['webhookEndpoint.delete', { param: { id: 'wh_1' } }],
      ['webhookEndpointSecret.post', { param: { id: 'wh_1' } }],
      ['webhookRequests.get', { param: { id: 'wh_1' }, query: { status: 'failed' } }],
      ['webhookRequest.get', { param: { id: 'wh_1', deliveryId: 'whr_1' } }],
      [
        'webhookDeliveryAttempt.post',
        { param: { id: 'wh_1', deliveryId: 'whr_1' }, header: { 'Idempotency-Key': 'retry-whr-1' } },
      ],
    ])
  })

  it('composes the dashboard from all management resources', async () => {
    const { management } = await loadManagementApi()

    await expect(management.getAdminDashboard()).resolves.toMatchObject({
      applications: { key: 'applications.get' },
      users: { key: 'users.get' },
      connectors: { key: 'connectors.get' },
      organizations: { key: 'organizations.get' },
      apiResources: { resources: [] },
      signIn: { key: 'signIn.get' },
      security: { key: 'security.get' },
    })
  })
})

async function loadManagementApi(options: { userSecurity?: unknown } = {}) {
  const calls: Array<[string, unknown?, unknown?]> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      calls.push(['fetch', String(input), init])
      return Promise.resolve(
        new Response(JSON.stringify({ scopes: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"permissions-v1"' },
        }),
      )
    }),
  )
  const endpoint = (key: string) =>
    vi.fn((input?: unknown) => {
      calls.push(input === undefined ? [key] : [key, input])
      return Promise.resolve(
        key === 'apiResources.get'
          ? { key, input, items: [], pagination: { limit: 50, offset: 0, total: 0 } }
          : key === 'user.get' && 'userSecurity' in options
            ? { key, input, security: options.userSecurity }
            : { key, input },
      )
    })

  vi.doMock('@/lib/api', () => ({
    apiClient: {
      api: {
        access: {
          consents: {
            $get: endpoint('applicationAuthorizations.get'),
            ':authorizationId': {
              revocation: { $put: endpoint('applicationAuthorizationRevocation.put') },
            },
          },
          requests: { $get: endpoint('agentAccessRequests.get') },
          roles: {
            $get: endpoint('roles.get'),
            $post: endpoint('roles.post'),
            ':id': {
              $get: endpoint('role.get'),
              $patch: endpoint('roles.patch'),
              $delete: endpoint('roles.delete'),
            },
          },
          assignments: {
            $get: endpoint('roleAssignments.get'),
            $post: endpoint('roleAssignments.post'),
            ':id': { revocation: { $put: endpoint('roleAssignmentRevocation.put') } },
          },
        },
        realm: {
          $get: endpoint('realm.get'),
          $patch: endpoint('realm.patch'),
          'sign-in-policy': { $get: endpoint('signIn.get'), $patch: endpoint('signIn.patch') },
          branding: { $get: endpoint('branding.get'), $patch: endpoint('branding.patch') },
          'account-management-policy': { $get: endpoint('accountCenter.get'), $patch: endpoint('accountCenter.patch') },
          'organization-creation-policy': {
            $get: endpoint('organizationCreation.get'),
            $put: endpoint('organizationCreation.put'),
          },
          'developer-console-access-policy': {
            $get: endpoint('developerConsole.get'),
            $put: endpoint('developerConsole.put'),
          },
          'email-delivery-configuration': { $get: endpoint('email.get'), $put: endpoint('email.put') },
          'configuration-status': { $get: endpoint('readiness.get') },
          'audit-events': { $get: endpoint('agentAudit.get') },
          'security-policy': { $get: endpoint('security.get'), $patch: endpoint('security.patch') },
        },
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
          ':applicationId': {
            'federated-credentials': {
              $get: endpoint('federatedCredentials.get'),
              $post: endpoint('federatedCredentials.post'),
              ':credentialId': {
                $patch: endpoint('federatedCredential.patch'),
                $delete: endpoint('federatedCredential.delete'),
              },
            },
          },
        },
        'application-authorizations': {
          $get: endpoint('applicationAuthorizations.get'),
          ':authorizationId': {
            revocation: { $put: endpoint('applicationAuthorizationRevocation.put') },
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
            suspension: {
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
        agents: {
          $get: endpoint('agentInventory.get'),
          ':agentId': {
            $delete: endpoint('agent.delete'),
            activation: {
              $put: endpoint('agentActivation.put'),
              $delete: endpoint('agentActivation.delete'),
            },
            'access-grants': { $get: endpoint('agentAccessGrants.get') },
          },
        },
        'audit-events': { $get: endpoint('agentAudit.get') },
        security: { policy: { $get: endpoint('security.get'), $patch: endpoint('security.patch') } },
        organizations: {
          $get: endpoint('organizations.get'),
          $post: endpoint('organizations.post'),
          ':id': { $patch: endpoint('organizations.patch') },
          ':organizationId': {
            roles: {
              $get: endpoint('organizationRoles.get'),
              $post: endpoint('organizationRoles.post'),
              ':roleKey': {
                $get: endpoint('organizationRole.get'),
                $patch: endpoint('organizationRole.patch'),
                $delete: endpoint('organizationRole.delete'),
              },
            },
            members: {
              ':memberId': {
                roles: {
                  $get: endpoint('memberRoles.get'),
                  $put: endpoint('memberRoles.put'),
                },
              },
            },
          },
        },
        'resource-servers': {
          $get: endpoint('apiResources.get'),
          $post: endpoint('apiResources.post'),
          ':id': {
            $get: endpoint('apiResource.get'),
            $patch: endpoint('apiResources.patch'),
            $delete: endpoint('apiResources.delete'),
            contract: { $get: endpoint('apiResourceContract.get') },
          },
        },
        webhooks: {
          $get: endpoint('webhookEndpoints.get'),
          $post: endpoint('webhookEndpoints.post'),
          ':id': {
            $patch: endpoint('webhookEndpoint.patch'),
            $delete: endpoint('webhookEndpoint.delete'),
            secrets: { $post: endpoint('webhookEndpointSecret.post') },
            deliveries: {
              $get: endpoint('webhookRequests.get'),
              ':deliveryId': {
                $get: endpoint('webhookRequest.get'),
                attempts: {
                  $get: endpoint('webhookDeliveryAttempts.get'),
                  $post: endpoint('webhookDeliveryAttempt.post'),
                },
              },
            },
          },
        },
      },
    },
    readJsonResponse: async (response: Response) => {
      if (!response.ok) throw new Error(`Request failed with status ${response.status}.`)
      return response.json()
    },
    readRpcResponse: (response: unknown) => response,
    uploadApiFile: (path: string, file: File) => {
      calls.push(['upload', path, file])
      return Promise.resolve({ asset: { publicUrl: `/uploaded/${file.name}` } })
    },
    uploadAsset: (purpose: string, file: File) => {
      calls.push(['uploadAsset', purpose, file])
      return Promise.resolve({ asset: { id: 'asset-1', purpose, publicUrl: '/api/assets/asset-1' } })
    },
  }))

  return {
    calls,
    management: await import('@/lib/api/management'),
  }
}
