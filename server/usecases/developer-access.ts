import type { Deps } from '@server/usecases/deps'
import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import type { OrganizationCreationPolicyResponse } from '@shared/api/management'

type DeveloperAccessUser = {
  id: string
  email: string
  emailVerified: boolean
  role: string | null
}

export async function resolveDeveloperAccess(
  deps: Pick<Deps, 'authorization' | 'configz'>,
  user: DeveloperAccessUser,
): Promise<DeveloperConsoleAccessResponse> {
  const [organizationCreationPolicy, consoleAccessPolicy] = await Promise.all([
    deps.configz.getOrganizationCreationPolicy(),
    deps.configz.getDeveloperConsoleAccessPolicy(),
  ])
  const memberships = await deps.authorization.listUserMemberships(user.id)
  const realmOperator = hasRole(user.role, 'admin')
  const resolvedMemberships = await Promise.all(
    memberships.map(async (membership) => ({
      membership,
      organization: await deps.authorization.findOrganization(membership.organizationId),
    })),
  )
  const activeMemberships = resolvedMemberships.filter(
    (entry): entry is typeof entry & { organization: NonNullable<typeof entry.organization> } =>
      entry.organization !== null && !entry.organization.disabled,
  )
  const selected = new Set(consoleAccessPolicy.selectedOrganizationIds)
  const eligibleLevels = new Set(consoleAccessPolicy.eligibleAccessLevels)
  const consoleOrganizations = activeMemberships.flatMap(({ membership, organization }) => {
    const accessLevel = (['owner', 'admin', 'developer'] as const).find(
      (role) => membership.roles.includes(role) && eligibleLevels.has(role),
    )
    if (!accessLevel) return []
    if (consoleAccessPolicy.mode === 'realm_operators') return []
    if (consoleAccessPolicy.mode === 'selected_organizations' && !selected.has(organization.id)) return []
    return [
      {
        organizationId: organization.id,
        accessLevel,
      },
    ]
  })
  const canCreateOrganization = mayCreateOrganization(organizationCreationPolicy, user)
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
  policy: OrganizationCreationPolicyResponse,
  user: Pick<DeveloperAccessUser, 'id' | 'emailVerified' | 'role'>,
) {
  return (
    hasRole(user.role, 'admin') ||
    (policy.mode === 'approved_users' && policy.approvedUserIds.includes(user.id)) ||
    (policy.mode === 'verified_users' && user.emailVerified)
  )
}

export function hasRole(value: string | null | undefined, required: string) {
  return (value ?? '')
    .split(',')
    .map((role) => role.trim())
    .includes(required)
}
