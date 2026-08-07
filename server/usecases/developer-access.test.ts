import { createTestDeps } from '@server/http/test-deps'
import { mayCreateOrganization, resolveDeveloperAccess } from '@server/usecases/developer-access'
import { describe, expect, it, vi } from 'vitest'

describe('Developer Console access', () => {
  it('resolves selected, active, eligible Organization memberships', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.configz.getOrganizationCreationPolicy).mockResolvedValue({
      mode: 'verified_users',
      approvedUserIds: [],
    })
    vi.mocked(deps.configz.getDeveloperConsoleAccessPolicy).mockResolvedValue({
      mode: 'selected_organizations',
      eligibleAccessLevels: ['owner', 'developer'],
      selectedOrganizationIds: ['org-selected'],
    })
    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([
      membership('org-selected', 'developer'),
      membership('org-unselected', 'owner'),
      membership('org-disabled', 'owner'),
      membership('org_platform', 'owner'),
      membership('org-missing', 'owner'),
      membership('org-selected', 'member'),
    ])
    vi.mocked(deps.authorization.findOrganization).mockImplementation(async (id) => {
      if (id === 'org-missing') return null
      return organization(id, id === 'org-disabled')
    })

    await expect(
      resolveDeveloperAccess(deps, {
        id: 'user-1',
        email: 'developer@example.com',
        emailVerified: true,
      }),
    ).resolves.toEqual({
      canCreateOrganization: true,
      showOrganizations: true,
      platformOperator: true,
      consoleOrganizations: [{ organizationId: 'org-selected', accessLevel: 'developer' }],
    })
    expect(deps.authorization.hasPendingInvitation).not.toHaveBeenCalled()
  })

  it('keeps Organization creation independent from Console eligibility', async () => {
    const deps = createTestDeps()
    vi.mocked(deps.configz.getOrganizationCreationPolicy).mockResolvedValue({
      mode: 'admins_only',
      approvedUserIds: [],
    })
    vi.mocked(deps.configz.getDeveloperConsoleAccessPolicy).mockResolvedValue({
      mode: 'realm_operators',
      eligibleAccessLevels: ['owner'],
      selectedOrganizationIds: [],
    })
    vi.mocked(deps.authorization.listUserMemberships).mockResolvedValue([membership('org-1', 'owner')])
    vi.mocked(deps.authorization.findOrganization).mockResolvedValue(organization('org-1', false))
    vi.mocked(deps.authorization.hasPendingInvitation).mockResolvedValue(true)

    await expect(
      resolveDeveloperAccess(deps, {
        id: 'user-1',
        email: 'invited@example.com',
        emailVerified: false,
      }),
    ).resolves.toEqual({
      canCreateOrganization: false,
      showOrganizations: true,
      platformOperator: false,
      consoleOrganizations: [],
    })
  })

  it('handles platform authority, approved users, and verified users', () => {
    expect(
      mayCreateOrganization(
        { mode: 'admins_only', approvedUserIds: [] },
        { id: 'admin-1', emailVerified: false },
        true,
      ),
    ).toBe(true)
    expect(
      mayCreateOrganization(
        { mode: 'approved_users', approvedUserIds: ['user-1'] },
        { id: 'user-1', emailVerified: false },
      ),
    ).toBe(true)
    expect(
      mayCreateOrganization({ mode: 'verified_users', approvedUserIds: [] }, { id: 'user-1', emailVerified: false }),
    ).toBe(false)
  })
})

function membership(organizationId: string, role: string) {
  return {
    id: `${organizationId}-${role}`,
    organizationId,
    userId: 'user-1',
    roles: [role],
    title: null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  }
}

function organization(id: string, disabled: boolean) {
  return {
    id,
    name: id,
    slug: id,
    displayName: null,
    logo: null,
    disabled,
    disabledReason: disabled ? 'disabled for test' : null,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  }
}
