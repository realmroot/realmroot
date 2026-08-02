import { createFileRoute } from '@tanstack/react-router'
import { ApiResourceDetailPage } from '@/features/console/extracted/api-resources'

export const Route = createFileRoute('/console/api-resources/$resourceId/overview')({
  component: ResourceOverviewRoute,
})

function ResourceOverviewRoute() {
  const { resourceId } = Route.useParams()
  return <ApiResourceDetailPage resourceId={resourceId} section="overview" />
}
