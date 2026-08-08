import { createTestDeps } from '@server/http/test-deps'
import type { AgentAuditEventRecord, AgentIdentityRecord, UserPublicProfile } from '@server/usecases/ports'
import { getPublicAgentProfile, getPublicUserProfile } from '@server/usecases/public-profiles'
import { describe, expect, it, vi } from 'vitest'

describe('Public profiles', () => {
  it('returns a minimal User summary without loading relationships [spec: account-center/public-user-profile]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.users.findPublicProfileByUsername).mockResolvedValue(userProfile())

    await expect(getPublicUserProfile(deps, 'jane', 'summary', 'https://identity.example.com')).resolves.toEqual({
      type: 'user',
      view: 'summary',
      id: 'user-1',
      username: 'jane',
      displayName: 'Jane Stone',
      picture: 'https://identity.example.com/api/assets/avatar-1',
      joinedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    })
    expect(deps.agentIdentities.listOwned).not.toHaveBeenCalled()
    expect(deps.agentAudit.list).not.toHaveBeenCalled()
  })

  it('adds bounded public relationships to the full User view', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.users.findPublicProfileByUsername).mockResolvedValue(userProfile())
    vi.mocked(deps.agentIdentities.listOwned).mockResolvedValue({
      items: [{ identity: agentIdentity(), bindings: [] }],
      total: 1,
      limit: 6,
      offset: 0,
    })
    vi.mocked(deps.agentAudit.list).mockResolvedValue({
      items: [auditEvent('agent.identity_enrolled'), auditEvent('resource.secret_changed', 'audit-private')],
      total: 2,
      limit: 30,
      offset: 0,
    })

    const profile = await getPublicUserProfile(deps, 'jane', 'full', 'https://identity.example.com')

    expect(profile).toMatchObject({
      view: 'full',
      bio: 'Agent builder',
      agentCount: 1,
      agents: [{ subject: 'agt_stable' }],
      recentActivity: [{ id: 'audit-1', action: 'agent.identity_enrolled' }],
    })
    expect(JSON.stringify(profile)).not.toContain('resource.secret_changed')
  })

  it('returns full Agent activity without leaking audit metadata [spec: agent-identity/public-agent-profile]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue(agentIdentity())
    vi.mocked(deps.users.getPublicProfile).mockResolvedValue(userProfile())
    vi.mocked(deps.agentAudit.summarizeByDay).mockResolvedValue([
      { date: new Date().toISOString().slice(0, 10), count: 2 },
    ])
    vi.mocked(deps.agentAudit.list).mockResolvedValue({
      items: [auditEvent('agent.identity_recovered')],
      total: 1,
      limit: 30,
      offset: 0,
    })

    const profile = await getPublicAgentProfile(deps, 'https://identity.example.com/api/auth', 'agt_stable', 'full')

    expect(profile).toMatchObject({
      type: 'agent',
      view: 'full',
      subject: 'agt_stable',
      owner: { type: 'user', username: 'jane' },
      activity: { total: 2, activeDays: 1, currentStreak: 1, longestStreak: 1 },
      recentActivity: [{ action: 'agent.identity_recovered' }],
    })
    expect(JSON.stringify(profile)).not.toContain('resource-1')
  })
})

function userProfile(): UserPublicProfile {
  return {
    user: {
      id: 'user-1',
      email: 'private@example.com',
      emailVerified: true,
      displayName: 'Jane Stone',
      username: 'jane',
      avatarAssetId: 'avatar-1',
      image: '/api/assets/avatar-1',
      role: 'user',
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    bio: 'Agent builder',
    location: 'Toronto',
    links: [{ type: 'website', label: 'Website', url: 'https://jane.example.com' }],
    profileUpdatedAt: new Date('2026-08-02T00:00:00.000Z'),
  }
}

function agentIdentity(): AgentIdentityRecord {
  return {
    id: 'identity-1',
    issuer: 'https://identity.example.com/api/auth',
    subject: 'agt_stable',
    name: 'Build Agent',
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    status: 'active',
    deletedAt: null,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  }
}

function auditEvent(action: string, id = 'audit-1'): AgentAuditEventRecord {
  return {
    id,
    action,
    result: 'allowed',
    realmOwned: false,
    ownerUserId: 'user-1',
    ownerOrganizationId: null,
    controllerUserId: 'user-1',
    subjectIssuer: null,
    subject: null,
    agentIdentityId: 'identity-1',
    hostId: 'private-host',
    resourceId: 'resource-1',
    resourceConnectionId: null,
    accessGrantId: null,
    scopes: ['private:scope'],
    reasonCode: null,
    metadata: { private: true },
    occurredAt: new Date(),
  }
}
