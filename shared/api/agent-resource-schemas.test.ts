import { createApiResourceSchema, decideAccessRequestSchema } from '@shared/api/agent-api'
import {
  associateExternalResourceConnectorRequestSchema,
  createAgentAccessRequestSchema,
  createResourceConnectionIntentRequestSchema,
  decideAgentAccessRequestByTokenSchema,
} from '@shared/api/external-resources'
import { describe, expect, it } from 'vitest'

describe('Agent resource schemas', () => {
  it('creates external API resources separately from connector association', () => {
    const input = {
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: 'https://projects.example.com',
      authorizationMode: 'external',
    }

    expect(createApiResourceSchema.safeParse(input).success).toBe(true)
    expect(associateExternalResourceConnectorRequestSchema.safeParse({ connectorId: 'connector-1' }).success).toBe(true)
    expect(associateExternalResourceConnectorRequestSchema.safeParse({ connectorId: null }).success).toBe(true)
    expect(associateExternalResourceConnectorRequestSchema.safeParse({ connectorId: '' }).success).toBe(false)
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
