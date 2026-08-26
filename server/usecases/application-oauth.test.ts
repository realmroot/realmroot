import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import { createTestDeps } from '@server/http/test-deps'
import { issueApplicationAccessToken } from '@server/usecases/application-oauth'
import { hashProviderSecret } from '@server/usecases/applications-utils'
import { realmrootOrganizationClaim } from '@shared/oauth-token-profile'
import { describe, expect, it, vi } from 'vitest'

const audience = 'https://auth.example.com/api'
const realmrootResourceServerId = 'resource-realmroot'

describe('Application OAuth token issuance', () => {
  it('issues a short-lived Bearer token from client credentials and effective Application Permissions', async () => {
    const deps = await fixture()
    const sign = vi.fn().mockResolvedValue('application-access-token')

    await expect(
      issueApplicationAccessToken(
        deps,
        {
          clientId: 'client_adapter',
          clientSecret: 'adapter-secret',
          scope: 'connection-events:write',
          resource: audience,
          expectedResource: audience,
        },
        { issuer: 'https://auth.example.com/api/auth', sign },
      ),
    ).resolves.toEqual({
      access_token: 'application-access-token',
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'connection-events:write',
    })
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'app_adapter',
        client_id: 'client_adapter',
        [realmrootOrganizationClaim]: 'org_platform',
        aud: audience,
        scope: 'connection-events:write',
      }),
      'at+jwt',
    )
  })

  it('rejects an unconfigured scope, missing Permission, another audience, and invalid credentials', async () => {
    const signer = { issuer: 'https://auth.example.com/api/auth', sign: vi.fn() }
    const input = {
      clientId: 'client_adapter',
      clientSecret: 'adapter-secret',
      scope: 'connection-events:write',
      resource: audience,
      expectedResource: audience,
    }
    const unconfigured = await fixture({ configuredScopes: [] })
    await expect(issueApplicationAccessToken(unconfigured, input, signer)).rejects.toMatchObject({
      error: 'invalid_scope',
    })

    const missingPermission = await fixture({ effectiveScopes: [] })
    await expect(issueApplicationAccessToken(missingPermission, input, signer)).rejects.toMatchObject({
      error: 'invalid_scope',
    })

    await expect(
      issueApplicationAccessToken(await fixture(), { ...input, resource: 'https://other.example.com/api' }, signer),
    ).rejects.toMatchObject({ error: 'invalid_target' })

    await expect(
      issueApplicationAccessToken(await fixture(), { ...input, clientSecret: 'wrong-secret' }, signer),
    ).rejects.toMatchObject({ error: 'invalid_client' })

    await expect(
      issueApplicationAccessToken(await fixture(), { ...input, clientSecret: null }, signer),
    ).rejects.toMatchObject({ error: 'invalid_client' })
    await expect(
      issueApplicationAccessToken(await fixture({ clientDisabled: true }), input, signer),
    ).rejects.toMatchObject({ error: 'invalid_client' })
    await expect(
      issueApplicationAccessToken(await fixture({ organizationDisabled: true }), input, signer),
    ).rejects.toMatchObject({ error: 'invalid_client' })
  })

  it('rejects unauthorized clients, unavailable Resources, and empty scopes', async () => {
    const signer = { issuer: 'https://auth.example.com/api/auth', sign: vi.fn() }
    const input = {
      clientId: 'client_adapter',
      clientSecret: 'adapter-secret',
      scope: 'connection-events:write',
      resource: audience,
      expectedResource: audience,
    }
    await expect(
      issueApplicationAccessToken(await fixture({ allowedGrantTypes: [] }), input, signer),
    ).rejects.toMatchObject({ error: 'unauthorized_client' })
    await expect(issueApplicationAccessToken(await fixture({ resource: null }), input, signer)).rejects.toMatchObject({
      error: 'invalid_target',
    })
    await expect(
      issueApplicationAccessToken(await fixture(), { ...input, scope: '   ' }, signer),
    ).rejects.toMatchObject({ error: 'invalid_scope' })
    await expect(
      issueApplicationAccessToken(await fixture(), { ...input, scope: undefined }, signer),
    ).rejects.toMatchObject({ error: 'invalid_scope' })
    await expect(
      issueApplicationAccessToken(await fixture({ configureResource: false }), input, signer),
    ).rejects.toMatchObject({ error: 'invalid_scope' })
  })
})

async function fixture(
  options: {
    configuredScopes?: string[]
    effectiveScopes?: string[]
    allowedGrantTypes?: string[]
    resource?: object | null
    configureResource?: boolean
    clientDisabled?: boolean
    organizationDisabled?: boolean
  } = {},
) {
  const configuredScopes = options.configuredScopes ?? ['connection-events:write']
  const effectiveScopes = options.effectiveScopes ?? ['connection-events:write']
  const application = {
    id: 'app_adapter',
    clientId: 'client_adapter',
    disabled: false,
    allowedGrantTypes: options.allowedGrantTypes ?? ['client_credentials'],
    ownerOrganizationId: 'org_platform',
    resourceScopes:
      options.configureResource === false
        ? []
        : [{ resourceServerId: realmrootResourceServerId, scopes: configuredScopes }],
  }
  const resource = {
    ...realmrootResourceServer,
    id: realmrootResourceServerId,
    resourceUrl: audience,
    enabled: true,
    visibility: 'public',
    scopeRegistry: {
      scopes: effectiveScopes.map((scope) => ({ value: scope, description: null, grantMode: 'assigned' })),
    },
  }
  return createTestDeps({
    applications: { findByClientId: vi.fn().mockResolvedValue(application) },
    tokenExchange: {
      findClient: vi.fn().mockResolvedValue({
        clientId: application.clientId,
        clientSecret: await hashProviderSecret('adapter-secret'),
        disabled: options.clientDisabled ?? false,
      }),
    },
    authorization: {
      findOrganization: vi
        .fn()
        .mockResolvedValue({ id: 'org_platform', disabled: options.organizationDisabled ?? false }),
      listResources: vi.fn().mockResolvedValue({
        items: options.resource === null ? [] : [options.resource === undefined ? resource : options.resource],
        pagination: {
          limit: 100,
          offset: 0,
          total: options.resource === null ? 0 : 1,
          hasMore: false,
          nextOffset: null,
        },
      }),
      listActiveApplicationScopeEntitlements: vi
        .fn()
        .mockResolvedValue(effectiveScopes.map((scope) => ({ scope, endedAt: null, expiresAt: null }))),
    },
  })
}
