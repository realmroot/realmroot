import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'

export const Route = createFileRoute('/organizations/$organizationId/roles')({ component: OrganizationRolesRoute })

function OrganizationRolesRoute() {
  const { organizationId } = Route.useParams()
  return <AccountOrganizationDetailPage organizationId={organizationId} section="roles" />
}
