import { toOAuthClientInsert } from '@server/adapters/repos/applications-mappers'
import type { ApplicationAggregate } from '@server/usecases/ports'
import { defaultApplicationOidcClaims } from '@shared/api/applications'
import { describe, expect, it } from 'vitest'

const application = {
  id: 'application-1',
  slug: 'application-1',
  name: 'Application',
  description: null,
  homepageUrl: null,
  iconUrl: null,
  clientId: 'client-1',
  clientType: 'public_spa',
  public: true,
  visibility: 'public',
  consentRequired: true,
  disabled: false,
  disabledReason: null,
  ownerOrganizationId: 'org-platform',
  redirectUris: ['https://client.example.com/callback'],
  postLogoutRedirectUris: [],
  corsOrigins: [],
  customData: {},
  allowedGrantTypes: ['authorization_code'],
  oidcScopes: ['openid'],
  resourceScopes: [],
  requirePkce: true,
  tokenEndpointAuthMethod: 'none',
  oidcClaims: defaultApplicationOidcClaims,
} satisfies Omit<ApplicationAggregate, 'createdAt' | 'updatedAt'>

describe('Application repository mappers', () => {
  it('maps the User consent policy to the inverse OAuth skip-consent flag', () => {
    const now = new Date('2026-08-20T00:00:00.000Z')

    expect(toOAuthClientInsert(application, null, now, 'oauth-client-1').skipConsent).toBe(false)
    expect(
      toOAuthClientInsert({ ...application, consentRequired: false }, null, now, 'oauth-client-2').skipConsent,
    ).toBe(true)
  })
})
