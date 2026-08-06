import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'

export const Route = createFileRoute('/organizations/$organizationId/overview')({
  component: OrganizationOverviewRoute,
})

function OrganizationOverviewRoute() {
  const { organizationId } = Route.useParams()
  return <AccountOrganizationDetailPage organizationId={organizationId} section="overview" />
}
