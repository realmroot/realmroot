import { createTestDeps } from '@server/http/test-deps'
import type { AgentAuditEventRecord, AgentIdentityRecord, UserPublicProfile } from '@server/usecases/ports'
import { getPublicAgentProfile, getPublicUserProfile } from '@server/usecases/public-profiles'
import { describe, expect, it, vi } from 'vitest'

const now = new Date('2026-08-08T12:00:00.000Z')

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

  it('returns nullable User presentation fields and conceals unavailable Users', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.users.findPublicProfileByUsername).mockResolvedValue({
      ...userProfile(),
      user: { ...userProfile().user, image: null },
      profileUpdatedAt: null,
    })

    await expect(getPublicUserProfile(deps, 'jane', 'summary', 'https://identity.example.com')).resolves.toMatchObject({
      picture: null,
      updatedAt: '2026-08-01T00:00:00.000Z',
    })

    vi.mocked(deps.users.findPublicProfileByUsername).mockResolvedValue(null)
    await expect(getPublicUserProfile(deps, 'missing', 'summary', 'https://identity.example.com')).rejects.toThrow(
      'Public User profile was not found.',
    )
    vi.mocked(deps.users.findPublicProfileByUsername).mockResolvedValue({
      ...userProfile(),
      user: { ...userProfile().user, banned: true },
    })
    await expect(getPublicUserProfile(deps, 'banned', 'summary', 'https://identity.example.com')).rejects.toThrow(
      'Public User profile was not found.',
    )
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
      links: [
        { type: 'website', label: 'Website', url: 'https://jane.example.com' },
        { type: 'linked-account', providerId: 'github', label: 'GitHub', url: 'https://github.com/jane' },
      ],
      recentActivity: [{ action: 'agent.identity_enrolled' }],
    })
    expect(JSON.stringify(profile)).not.toContain('account-github')
    expect(JSON.stringify(profile)).not.toContain('resource.secret_changed')
    expect(deps.agentAudit.list).toHaveBeenCalledWith(
      { limit: 10, offset: 0 },
      expect.objectContaining({ actions: expect.arrayContaining(['agent.identity_enrolled']) }),
    )
  })

  it('returns full Agent activity without leaking audit metadata [spec: agent-identity/public-agent-profile]', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue(agentIdentity())
    vi.mocked(deps.users.getPublicProfile).mockResolvedValue(userProfile())
    vi.mocked(deps.agentAudit.summarizeByDay).mockResolvedValue([{ date: '2026-08-08', count: 2 }])
    vi.mocked(deps.agentAudit.list).mockResolvedValue({
      items: [auditEvent('agent.identity_recovered')],
      total: 1,
      limit: 30,
      offset: 0,
    })

    const profile = await getPublicAgentProfile(
      deps,
      'https://identity.example.com/api/auth',
      'agt_stable',
      'full',
      now,
    )

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

  it('computes current and longest streaks from an injected clock', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue(agentIdentity())
    vi.mocked(deps.users.getPublicProfile).mockResolvedValue(userProfile())
    vi.mocked(deps.agentAudit.summarizeByDay).mockResolvedValue([
      { date: '2026-08-01', count: 1 },
      { date: '2026-08-02', count: 1 },
      { date: '2026-08-03', count: 1 },
      { date: '2026-08-07', count: 1 },
      { date: '2026-08-08', count: 1 },
      { date: '2026-08-06', count: 0 },
    ])

    const profile = await getPublicAgentProfile(
      deps,
      'https://identity.example.com/api/auth',
      'agt_stable',
      'full',
      now,
    )

    expect(profile).toMatchObject({ activity: { total: 5, activeDays: 5, currentStreak: 2, longestStreak: 3 } })
    expect(deps.agentAudit.summarizeByDay).toHaveBeenCalledWith(new Date('2025-08-09T00:00:00.000Z'), {
      agentIdentityId: 'identity-1',
    })
  })

  it('returns an organization owner and supports the Agent summary view', async () => {
    const deps = createTestDeps()
    const identity = { ...agentIdentity(), ownerUserId: null, ownerOrganizationId: 'org-1' }
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue(identity)
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      slug: 'builders',
      name: 'Builders Inc.',
      displayName: 'Builders',
      logo: null,
    } as never)

    await expect(
      getPublicAgentProfile(deps, identity.issuer, identity.subject, 'summary', now),
    ).resolves.not.toHaveProperty('owner')
    const profile = await getPublicAgentProfile(deps, identity.issuer, identity.subject, 'full', now)
    expect(profile).toMatchObject({ owner: { type: 'organization', id: 'org-1', displayName: 'Builders' } })

    vi.mocked(deps.authorization.findOrganization).mockResolvedValue({
      id: 'org-1',
      slug: 'builders',
      name: 'Builders Inc.',
      displayName: null,
      logo: null,
    } as never)
    await expect(getPublicAgentProfile(deps, identity.issuer, identity.subject, 'full', now)).resolves.toMatchObject({
      owner: { displayName: 'Builders Inc.' },
    })
  })

  it('conceals missing Agent identities and owners', async () => {
    const deps = createTestDeps()
    await expect(
      getPublicAgentProfile(deps, 'https://identity.example.com/api/auth', 'agt_missing', 'summary'),
    ).rejects.toThrow('Public Agent profile was not found.')

    const identity = { ...agentIdentity(), ownerUserId: null, ownerOrganizationId: 'org-missing' }
    vi.mocked(deps.agentIdentities.findByIssuerSubject).mockResolvedValue(identity)
    await expect(getPublicAgentProfile(deps, identity.issuer, identity.subject, 'full', now)).rejects.toThrow(
      'Agent owner was not found.',
    )
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
    links: [
      { type: 'website', label: 'Website', url: 'https://jane.example.com' },
      {
        type: 'linked-account',
        accountId: 'account-github',
        providerId: 'github',
        label: 'GitHub',
        url: 'https://github.com/jane',
      },
    ],
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
    occurredAt: now,
  }
}
