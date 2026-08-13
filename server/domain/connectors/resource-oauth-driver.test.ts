import { resourceOAuthDriver } from '@server/domain/connectors/resource-oauth-driver'
import type { ConnectorRecord } from '@server/usecases/ports'
import { describe, expect, it } from 'vitest'

describe('resource OAuth drivers', () => {
  it('[spec: agent-identity/linear-managed-workspace-connections] isolates Linear resource authorization from login', async () => {
    const driver = resourceOAuthDriver(connector({ providerType: 'social', providerId: 'linear' }))

    expect(driver).not.toBeNull()
    expect(driver).toMatchObject({
      authorizationEndpoint: 'https://linear.app/oauth/authorize',
      tokenEndpoint: 'https://api.linear.app/oauth/token',
      authorizationParameters: { actor: 'app', prompt: 'consent' },
      tokenEndpointAuthentication: 'post',
      revocationAuthentication: 'none',
      authorizationDetailsMode: 'connection',
      revokeAccessToken: false,
      scopeSeparator: ',',
    })
    expect(driver!.normalizeScopes(['issues:create', 'read', 'read'])).toEqual(['issues:create', 'read'])

    const request = driver!.profileRequest('linear-access-token')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe('Bearer linear-access-token')
    expect(await request.json()).toEqual({
      query: 'query RealmrootProviderConnection { viewer { id name } organization { id name } }',
    })
    expect(driver!.parseProfile({ data: { organization: { id: 'workspace-1', name: 'Acme' } } })).toEqual({
      externalSubject: 'workspace-1',
      displayName: 'Acme',
    })
    expect(driver!.authorizationDetails?.({ externalSubject: 'workspace-1', displayName: 'Acme' })).toEqual([
      { type: 'linear_workspace', workspace_id: 'workspace-1', workspace_name: 'Acme' },
    ])
  })

  it('uses standard OIDC identity and consent behavior for generic managed and federated connectors', () => {
    const driver = resourceOAuthDriver(connector())

    expect(driver).not.toBeNull()
    expect(driver!.authorizationParameters).toEqual({ prompt: 'consent' })
    expect(driver!.normalizeScopes(['projects:read'])).toEqual(['offline_access', 'openid', 'projects:read'])
    expect(driver!.parseProfile({ sub: 'subject-1', preferred_username: 'ambor' })).toEqual({
      externalSubject: 'subject-1',
      displayName: 'ambor',
    })
  })

  it('uses client_secret_post when the OIDC metadata only advertises it', () => {
    const driver = resourceOAuthDriver(
      connector({ providerMetadata: { token_endpoint_auth_methods_supported: ['client_secret_post'] } }),
    )
    expect(driver).toMatchObject({ tokenEndpointAuthentication: 'post', revocationAuthentication: 'post' })
  })
})

function connector(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: 'connector-1',
    slug: 'provider',
    providerType: 'generic_oauth',
    providerId: 'oidc',
    displayName: 'Provider',
    enabled: true,
    authenticationEnabled: false,
    issuer: 'https://provider.example.com',
    authorizationEndpoint: 'https://provider.example.com/authorize',
    tokenEndpoint: 'https://provider.example.com/token',
    userInfoEndpoint: 'https://provider.example.com/userinfo',
    jwksEndpoint: 'https://provider.example.com/jwks',
    registrationEndpoint: null,
    revocationEndpoint: 'https://provider.example.com/revoke',
    clientId: 'client-id',
    clientSecret: 'sealed:client-secret',
    clientSecretContext: null,
    registrationMode: 'manual',
    registrationClientUri: null,
    registrationAccessToken: null,
    registrationAccessTokenContext: null,
    clientGeneration: 1,
    scopes: ['openid'],
    attributeMapping: null,
    providerMetadata: null,
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    ...overrides,
  }
}
