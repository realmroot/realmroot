import { type AuthorizationContext, authorize } from '@server/domain/authorization-context'
import { describe, expect, it } from 'vitest'

const context: AuthorizationContext = {
  subject: { type: 'user', id: 'user-1' },
  tenant: { type: 'organization', id: 'org-1' },
  scopes: new Set(['applications:read']),
}

describe('authorization context', () => {
  it('requires both the target tenant and scope to match', () => {
    expect(() => authorize(context, { type: 'organization', id: 'org-1' }, 'applications:read')).not.toThrow()
    expect(() => authorize(context, { type: 'organization', id: 'org-2' }, 'applications:read')).toThrow(
      'cannot access the target tenant',
    )
    expect(() => authorize(context, { type: 'organization', id: 'org-1' }, 'applications:write')).toThrow(
      'applications:write',
    )
  })

  it('does not treat a User tenant as the same boundary as an Organization', () => {
    expect(() => authorize(context, { type: 'user', id: 'org-1' }, 'applications:read')).toThrow(
      'cannot access the target tenant',
    )
  })

  it.each([
    'user',
    'agent',
    'application',
    'workload',
  ] as const)('applies the same tenant-and-scope decision to a %s subject', (type) => {
    const actorContext: AuthorizationContext = {
      subject: { type, id: `${type}-1` },
      tenant: { type: 'user', id: 'user-1' },
      scopes: new Set(['agents:read']),
    }
    expect(() => authorize(actorContext, { type: 'user', id: 'user-1' }, 'agents:read')).not.toThrow()
    expect(() => authorize(actorContext, { type: 'user', id: 'user-2' }, 'agents:read')).toThrow()
    expect(() => authorize(actorContext, { type: 'user', id: 'user-1' }, 'agents:write')).toThrow()
  })
})
