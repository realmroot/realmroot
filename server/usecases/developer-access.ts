import { platformOrganization } from '@server/domain/platform-organization'
import { realmrootResourceServer } from '@server/domain/realmroot-resource-server'
import type { Deps } from '@server/usecases/deps'
import { resolveOrganizationMembershipScopes } from '@server/usecases/organization-membership-scopes'
import type { DeveloperConsoleAccessResponse } from '@shared/api/account'
import type { OrganizationCreationPolicyResponse } from '@shared/api/management'

type DeveloperAccessUser = {
  id: string
  email: string
  emailVerified: boolean
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
  const platformMembership = memberships.find((membership) => membership.organizationId === platformOrganization.id)
  const platformScopes = new Set(
    platformMembership
      ? await resolveOrganizationMembershipScopes(
          deps,
          platformOrganization.id,
          platformMembership.roles,
          realmrootResourceServer.id,
        )
      : [],
  )
  const platformOperator = platformScopes.size > 0
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
  const canCreateOrganization = mayCreateOrganization(
    organizationCreationPolicy,
    user,
    platformScopes.has('organizations:write'),
  )
  const showOrganizations =
    canCreateOrganization ||
    memberships.length > 0 ||
    (await deps.authorization.hasPendingInvitation(user.email, new Date()))

  return {
    canCreateOrganization,
    showOrganizations,
    platformOperator,
    consoleOrganizations,
  }
}

export function mayCreateOrganization(
  policy: OrganizationCreationPolicyResponse,
  user: Pick<DeveloperAccessUser, 'id' | 'emailVerified'>,
  platformCanCreateOrganization = false,
) {
  return (
    platformCanCreateOrganization ||
    (policy.mode === 'approved_users' && policy.approvedUserIds.includes(user.id)) ||
    (policy.mode === 'verified_users' && user.emailVerified)
  )
}
