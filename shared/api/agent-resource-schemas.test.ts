import { createApiResourceSchema, decideAccessRequestSchema } from '@shared/api/agent-api'
import {
  configureExternalResourceAuthorizationRequestSchema,
  createAgentAccessRequestSchema,
  createResourceConnectionIntentRequestSchema,
  decideAgentAccessRequestByTokenSchema,
} from '@shared/api/external-resources'
import { describe, expect, it } from 'vitest'

describe('Agent resource schemas', () => {
  it('requires authorization configuration for external API resources', () => {
    const input = {
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: 'https://projects.example.com',
      authorizationMode: 'external',
    }

    expect(createApiResourceSchema.safeParse(input).success).toBe(false)
    expect(
      createApiResourceSchema.safeParse({
        ...input,
        authorization: { registrationMode: 'dynamic' },
      }).success,
    ).toBe(true)
  })

  it('requires approval mode and expiry for limited access decisions', () => {
    expect(decideAccessRequestSchema.safeParse({ decision: 'approve' }).success).toBe(false)
    expect(decideAccessRequestSchema.safeParse({ decision: 'approve', mode: 'until' }).success).toBe(false)
    expect(
      decideAccessRequestSchema.safeParse({
        decision: 'approve',
        mode: 'until',
        expiresAt: '2026-08-01T00:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(decideAccessRequestSchema.safeParse({ decision: 'deny' }).success).toBe(true)
  })

  it('validates manual client registration credentials', () => {
    expect(configureExternalResourceAuthorizationRequestSchema.safeParse({ registrationMode: 'manual' }).success).toBe(
      false,
    )
    expect(
      configureExternalResourceAuthorizationRequestSchema.safeParse({
        registrationMode: 'manual',
        clientId: 'client-1',
      }).success,
    ).toBe(false)
    expect(
      configureExternalResourceAuthorizationRequestSchema.safeParse({
        registrationMode: 'manual',
        clientId: 'client-1',
        clientSecret: 'secret-1',
      }).success,
    ).toBe(true)
    expect(configureExternalResourceAuthorizationRequestSchema.safeParse({ registrationMode: 'dynamic' }).success).toBe(
      true,
    )
  })

  it('normalizes connection and access-request scopes', () => {
    expect(createResourceConnectionIntentRequestSchema.safeParse({}).success).toBe(false)
    expect(
      createResourceConnectionIntentRequestSchema.parse({
        owner: { type: 'organization', organizationId: 'org-1' },
        scopes: ['write', 'read', 'write'],
      }),
    ).toEqual({
      owner: { type: 'organization', organizationId: 'org-1' },
      scopes: ['read', 'write'],
    })
    expect(
      createAgentAccessRequestSchema.parse({
        resourceId: 'resource-1',
        connectionId: null,
        scopes: ['write', 'read', 'write'],
      }).scopes,
    ).toEqual(['read', 'write'])
  })

  it('validates approval-token decisions', () => {
    expect(
      decideAgentAccessRequestByTokenSchema.safeParse({
        token: 'token',
        decision: 'approve',
      }).success,
    ).toBe(false)
    expect(
      decideAgentAccessRequestByTokenSchema.safeParse({
        token: 'token',
        decision: 'approve',
        mode: 'until',
      }).success,
    ).toBe(false)
    expect(
      decideAgentAccessRequestByTokenSchema.safeParse({
        token: 'token',
        decision: 'approve',
        mode: 'until',
        expiresAt: '2026-08-01T00:00:00.000Z',
      }).success,
    ).toBe(true)
    expect(
      decideAgentAccessRequestByTokenSchema.safeParse({
        token: 'token',
        decision: 'deny',
      }).success,
    ).toBe(true)
  })
})
