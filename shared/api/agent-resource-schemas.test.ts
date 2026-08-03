import { createApiResourceSchema, decideAccessRequestSchema, updateApiResourceSchema } from '@shared/api/agent-api'
import {
  createAgentAccessRequestSchema,
  createResourceConnectionIntentRequestSchema,
  decideAgentAccessRequestByTokenSchema,
} from '@shared/api/external-resources'
import { describe, expect, it } from 'vitest'

describe('Agent resource schemas', () => {
  it('creates external API resources by selecting a connector', () => {
    const input = {
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: 'https://projects.example.com',
      connectorId: 'connector-1',
    }

    expect(createApiResourceSchema.safeParse(input).success).toBe(true)
    expect(createApiResourceSchema.safeParse({ ...input, connectorId: '' }).success).toBe(false)
    expect(updateApiResourceSchema.safeParse({ connectorId: null }).success).toBe(true)
  })

  it('preserves opaque JSON authorization details and rejects malformed values', () => {
    const input = {
      identifier: 'projects',
      name: 'Projects',
      resourceUrl: 'https://projects.example.com',
      connectorId: 'connector-1',
      authorizationDetails: [
        {
          type: 'project_access',
          project_id: 'project-1',
          actions: ['read', 'comment'],
          tenant: { id: 'tenant-1', delegated: true },
          limit: null,
        },
      ],
    }

    expect(createApiResourceSchema.parse(input).authorizationDetails).toEqual(input.authorizationDetails)
    expect(
      createApiResourceSchema.safeParse({ ...input, authorizationDetails: [{ project_id: 'project-1' }] }).success,
    ).toBe(false)
    expect(
      createApiResourceSchema.safeParse({
        ...input,
        authorizationDetails: [{ type: 'project_access', invalid: () => undefined }],
      }).success,
    ).toBe(false)
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
