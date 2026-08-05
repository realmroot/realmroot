import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'

export const Route = createFileRoute('/organizations/$organizationId/members')({ component: OrganizationMembersRoute })

function OrganizationMembersRoute() {
  const { organizationId } = Route.useParams()
  return <AccountOrganizationDetailPage organizationId={organizationId} section="members" />
}
