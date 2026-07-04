import {
  createManagementFederatedCredentialRequestSchema,
  createManagementFederatedCredentialResponseSchema,
  listManagementFederatedCredentialsResponseSchema,
  updateManagementFederatedCredentialRequestSchema,
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
