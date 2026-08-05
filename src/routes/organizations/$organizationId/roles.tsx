import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { RolesPage } from '@/features/roles/management-roles'

export const Route = createFileRoute('/organizations/$organizationId/roles')({ component: OrganizationRolesRoute })

function OrganizationRolesRoute() {
  const { organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<RolesPage organizationId={organizationId} />}
      organizationId={organizationId}
      section="roles"
    />
  )
}
