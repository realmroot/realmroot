import {
  createManagementFederatedCredentialRequestSchema,
  createManagementFederatedCredentialResponseSchema,
  listManagementFederatedCredentialsResponseSchema,
  updateManagementBrandingSettingsRequestSchema,
  updateManagementFederatedCredentialRequestSchema,
  updateManagementSignInSettingsRequestSchema,
} from '@shared/api/management'
import { describe, expect, it } from 'vitest'

const credential = {
  id: 'cred-1',
  applicationId: 'app-1',
  name: 'Runner workload',
  issuer: 'https://platform.example.com',
  subject: 'org_1:*',
  audienceResourceId: 'resource-1',
  jwksUrl: 'https://platform.example.com/jwks',
  publicKeys: null,
  enabled: true,
  metadata: { owner: 'platform' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('management API federated credential contracts', () => {
  it('requires create requests to include exactly usable key material', () => {
    expect(
      createManagementFederatedCredentialRequestSchema.parse({
        name: ' Runner workload ',
        issuer: ' https://platform.example.com ',
        subject: ' org_1:* ',
        audienceResourceId: ' resource-1 ',
        jwksUrl: 'https://platform.example.com/jwks',
      }),
    ).toMatchObject({
      name: 'Runner workload',
      issuer: 'https://platform.example.com',
      subject: 'org_1:*',
      audienceResourceId: 'resource-1',
      jwksUrl: 'https://platform.example.com/jwks',
    })

    expect(
      createManagementFederatedCredentialRequestSchema.parse({
        name: 'Inline key',
        issuer: 'https://platform.example.com',
        subject: 'runner-1',
        audienceResourceId: 'resource-1',
        publicKeys: [{ kty: 'RSA', kid: 'key-1' }],
        metadata: null,
      }).publicKeys,
    ).toEqual([{ kty: 'RSA', kid: 'key-1' }])

    expect(() =>
      createManagementFederatedCredentialRequestSchema.parse({
        name: 'Missing key material',
        issuer: 'https://platform.example.com',
        subject: 'runner-1',
        audienceResourceId: 'resource-1',
      }),
    ).toThrow()
  })

  it('parses update and response envelopes', () => {
    expect(
      updateManagementFederatedCredentialRequestSchema.parse({
        enabled: false,
        jwksUrl: null,
        publicKeys: [{ kty: 'EC', crv: 'P-256' }],
      }),
    ).toEqual({
      enabled: false,
      jwksUrl: null,
      publicKeys: [{ kty: 'EC', crv: 'P-256' }],
    })

    expect(listManagementFederatedCredentialsResponseSchema.parse({ credentials: [credential] }).credentials).toEqual([
      credential,
    ])
    expect(createManagementFederatedCredentialResponseSchema.parse({ credential }).credential).toEqual(credential)
  })
})

describe('management branding contracts', () => {
  it('accepts managed asset paths and HTTPS external assets only [spec: admin-console/admin-branding-settings]', () => {
    expect(
      updateManagementBrandingSettingsRequestSchema.parse({
        branding: {
          logoUrl: '/api/assets/asset_0123456789abcdef',
          faviconUrl: 'https://cdn.example.com/favicon.ico',
        },
      }),
    ).toEqual({
      branding: {
        logoUrl: '/api/assets/asset_0123456789abcdef',
        faviconUrl: 'https://cdn.example.com/favicon.ico',
      },
    })

    expect(() =>
      updateManagementBrandingSettingsRequestSchema.parse({
        branding: { logoUrl: 'http://cdn.example.com/logo.png' },
      }),
    ).toThrow()
    expect(() =>
      updateManagementBrandingSettingsRequestSchema.parse({
        branding: { logoUrl: '/uploads/logo.png' },
      }),
    ).toThrow()
  })
})

describe('management sign-in contracts', () => {
  it('accepts nullable or HTTPS legal links and rejects insecure URLs', () => {
    expect(
      updateManagementSignInSettingsRequestSchema.parse({
        links: {
          termsUri: null,
          privacyUri: 'https://realm.example.com/privacy',
          supportUri: 'https://realm.example.com/support',
          supportEmail: null,
        },
      }),
    ).toEqual({
      links: {
        termsUri: null,
        privacyUri: 'https://realm.example.com/privacy',
        supportUri: 'https://realm.example.com/support',
        supportEmail: null,
      },
    })
    expect(() =>
      updateManagementSignInSettingsRequestSchema.parse({ links: { termsUri: 'http://realm.example.com/terms' } }),
    ).toThrow('URL must use https.')
  })
})
