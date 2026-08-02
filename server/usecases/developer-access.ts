import type { Deps } from '@server/usecases/deps'
import type { AccountProfileResponse } from '@shared/api/account'
import type { ManagementDeveloperSettingsResponse } from '@shared/api/management'

type DeveloperAccessUser = {
  id: string
  email: string
  emailVerified: boolean
  role: string | null
}

export async function resolveDeveloperAccess(
  deps: Pick<Deps, 'authorization' | 'configz'>,
  user: DeveloperAccessUser,
): Promise<AccountProfileResponse['access']> {
  const settings = await deps.configz.getDeveloperSettings()
  const memberships = await deps.authorization.listUserMemberships(user.id)
  const realmOperator = hasRole(user.role, 'admin')
  const activeMemberships = (
    await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        organization: await deps.authorization.findOrganization(membership.organizationId),
      })),
    )
  ).filter(({ organization }) => organization && !organization.disabled)
  const selected = new Set(settings.selectedOrganizationIds)
  const eligibleLevels = new Set(settings.eligibleAccessLevels)
  const consoleOrganizations = activeMemberships.flatMap(({ membership, organization }) => {
    if (!organization || organization.id === 'org_platform') return []
    if (!eligibleLevels.has(membership.role as 'owner' | 'admin' | 'developer')) return []
    if (settings.consoleAccess === 'realm_operators') return []
    if (settings.consoleAccess === 'selected_organizations' && !selected.has(organization.id)) return []
    return [
      {
        organizationId: organization.id,
        accessLevel: membership.role as 'owner' | 'admin' | 'developer',
      },
    ]
  })
  const canCreateOrganization = mayCreateOrganization(settings, user)
  const showOrganizations =
    canCreateOrganization ||
    memberships.length > 0 ||
    (await deps.authorization.hasPendingInvitation(user.email, new Date()))

  return {
    canCreateOrganization,
    showOrganizations,
    realmOperator,
    consoleOrganizations,
  }
}

export function mayCreateOrganization(
  settings: ManagementDeveloperSettingsResponse,
  user: Pick<DeveloperAccessUser, 'id' | 'emailVerified' | 'role'>,
) {
  return (
    hasRole(user.role, 'admin') ||
    (settings.organizationCreation === 'approved_users' && settings.approvedUserIds.includes(user.id)) ||
    (settings.organizationCreation === 'verified_users' && user.emailVerified)
  )
}

export function hasRole(value: string | null | undefined, required: string) {
  return (value ?? '')
    .split(',')
    .map((role) => role.trim())
    .includes(required)
}
