import { createFileRoute } from '@tanstack/react-router'
import { ApiResourceDetailPage } from '@/features/console/extracted/api-resources'

export const Route = createFileRoute('/console/api-resources/$resourceId/authority')({
  component: ResourceAuthorityRoute,
})

function ResourceAuthorityRoute() {
  const { resourceId } = Route.useParams()
  return <ApiResourceDetailPage resourceId={resourceId} section="authority" />
}
