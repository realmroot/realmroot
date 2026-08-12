import { describe, expect, it } from 'vitest'
import { agentPublicIdentifierSchema, agentSubjectSchema, agentUsernameSchema, uuidV7Schema } from './identifiers'
import { webhookEventEnvelopeSchema } from './webhooks'

describe('resource identifier contracts', () => {
  it('accepts UUIDv7 for new resources and legacy Agent subjects for existing references [spec: management-api/management-resource-identifiers]', () => {
    expect(uuidV7Schema.safeParse('019fed9e-72a7-73fe-bbe5-bb0f7e18a339').success).toBe(true)
    expect(agentSubjectSchema.safeParse('019fed9e-72a7-73fe-bbe5-bb0f7e18a339').success).toBe(true)
    expect(agentSubjectSchema.safeParse('agt_existing').success).toBe(true)
    expect(agentSubjectSchema.safeParse('wrong').success).toBe(false)
  })

  it('accepts explicit standard Agent usernames and rejects display names [spec: agent-identity/agent-identity-enrollment]', () => {
    expect(agentUsernameSchema.parse('Build_Agent')).toBe('build_agent')
    expect(agentPublicIdentifierSchema.safeParse('build-agent').success).toBe(true)
    expect(agentPublicIdentifierSchema.safeParse('agt_existing').success).toBe(true)
    expect(agentUsernameSchema.safeParse('Build Agent').success).toBe(false)
    expect(agentUsernameSchema.safeParse('构建-agent').success).toBe(false)
    expect(agentUsernameSchema.safeParse('ab').success).toBe(false)
  })

  it('accepts new and legacy webhook event identifiers [spec: management-api/management-resource-identifiers]', () => {
    const event = {
      id: '019fed9e-72a7-73fe-bbe5-bb0f7e18a339',
      type: 'user.created' as const,
      createdAt: '2026-08-10T12:00:00.000Z',
      data: {},
    }

    expect(webhookEventEnvelopeSchema.safeParse(event).success).toBe(true)
    expect(webhookEventEnvelopeSchema.safeParse({ ...event, id: 'evt_existing' }).success).toBe(true)
    expect(webhookEventEnvelopeSchema.safeParse({ ...event, id: 'wrong' }).success).toBe(false)
  })
})
