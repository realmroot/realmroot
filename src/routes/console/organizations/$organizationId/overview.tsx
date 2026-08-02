import { createFileRoute } from '@tanstack/react-router'
import { OrganizationDetailPage } from '@/features/console/extracted/organizations'

export const Route = createFileRoute('/console/organizations/$organizationId/overview')({
  component: OrganizationOverviewRoute,
})

function OrganizationOverviewRoute() {
  const { organizationId } = Route.useParams()
  return <OrganizationDetailPage organizationId={organizationId} section="overview" />
}
