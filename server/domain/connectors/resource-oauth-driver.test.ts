import { resourceOAuthDriver } from '@server/domain/connectors/resource-oauth-driver'
import type { ConnectorRecord } from '@server/usecases/ports'
import { describe, expect, it } from 'vitest'

describe('resource OAuth drivers', () => {
  it(`[spec: agent-identity/linear-managed-workspace-connections]
      [spec: agent-identity/adapter-external-resource-authorization] uses the standard external issuer configured on the Connector`, () => {
    const driver = resourceOAuthDriver(connector())

    expect(driver).not.toBeNull()
    expect(driver!.authorizationParameters).toEqual({ prompt: 'consent' })
    expect(driver!.normalizeScopes(['projects:read'])).toEqual(['offline_access', 'openid', 'projects:read'])
    expect(driver!.parseProfile({ sub: 'subject-1', preferred_username: 'ambor' })).toEqual({
      externalSubject: 'subject-1',
      displayName: 'ambor',
    })
    expect(driver!.parseProfile({ sub: 'subject-2', name: 'Ambor' })).toEqual({
      externalSubject: 'subject-2',
      displayName: 'Ambor',
    })
    expect(driver!.parseProfile({ sub: 'subject-3' })).toEqual({
      externalSubject: 'subject-3',
      displayName: 'subject-3',
    })
    expect(driver!.profileRequest('oidc-access-token').headers.get('authorization')).toBe('Bearer oidc-access-token')
  })

  it('uses client_secret_post when the OIDC metadata only advertises it', () => {
    const driver = resourceOAuthDriver(
      connector({ resourceProviderMetadata: { token_endpoint_auth_methods_supported: ['client_secret_post'] } }),
    )
    expect(driver).toMatchObject({ tokenEndpointAuthentication: 'post', revocationAuthentication: 'post' })
  })

  it('rejects unsupported and incomplete connectors', () => {
    expect(resourceOAuthDriver(connector({ resourceAuthorizationEnabled: false }))).toBeNull()

    for (const endpoint of [
      'resourceAuthorizationEndpoint',
      'resourceTokenEndpoint',
      'resourceUserInfoEndpoint',
      'resourceRevocationEndpoint',
    ] as const) {
      expect(resourceOAuthDriver(connector({ [endpoint]: null }))).toBeNull()
    }
  })

  it('rejects malformed provider identity responses', () => {
    const oidc = resourceOAuthDriver(connector())!

    expect(() => oidc.parseProfile({ sub: '' })).toThrow('OIDC userinfo response is missing sub')
    expect(() => oidc.parseProfile({ sub: ['subject'] })).toThrow('OIDC userinfo response is missing sub')
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
    resourceAuthorizationEnabled: true,
    resourceClientId: 'resource-client-id',
    resourceClientSecret: 'sealed:resource-client-secret',
    resourceClientSecretContext: null,
    resourceIssuer: 'https://provider.example.com',
    resourceAuthorizationEndpoint: 'https://provider.example.com/authorize',
    resourceTokenEndpoint: 'https://provider.example.com/token',
    resourceUserInfoEndpoint: 'https://provider.example.com/userinfo',
    resourceJwksEndpoint: 'https://provider.example.com/jwks',
    resourceRegistrationEndpoint: null,
    resourceRevocationEndpoint: 'https://provider.example.com/revoke',
    resourceRegistrationMode: 'manual',
    resourceRegistrationClientUri: null,
    resourceRegistrationAccessToken: null,
    resourceRegistrationAccessTokenContext: null,
    resourceRegisteredScopes: null,
    resourceClientGeneration: 1,
    resourceRetiredClientGenerations: null,
    resourceProviderMetadata: null,
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    ...overrides,
  }
}
