import { createFileRoute } from '@tanstack/react-router'
import { OrganizationDetailPage } from '@/features/console/extracted/organizations'

export const Route = createFileRoute('/console/organizations/$organizationId/activity')({
  component: OrganizationActivityRoute,
})

function OrganizationActivityRoute() {
  const { organizationId } = Route.useParams()
  return <OrganizationDetailPage organizationId={organizationId} section="activity" />
}
