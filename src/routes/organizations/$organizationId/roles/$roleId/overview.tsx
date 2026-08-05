import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { RoleDetailPage } from '@/features/roles/management-roles'

export const Route = createFileRoute('/organizations/$organizationId/roles/$roleId/overview')({
  component: OrganizationRoleOverviewRoute,
})

function OrganizationRoleOverviewRoute() {
  const { organizationId, roleId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<RoleDetailPage organizationId={organizationId} roleId={roleId} section="overview" />}
      organizationId={organizationId}
      section="roles"
    />
  )
}
