import { createFileRoute } from '@tanstack/react-router'
import { ApiResourceDetailPage } from '@/features/resource-servers/management-resource-servers'

export const Route = createFileRoute('/console/api-resources/$resourceId/scopes')({
  component: ResourceScopesRoute,
})

function ResourceScopesRoute() {
  const { resourceId } = Route.useParams()
  return <ApiResourceDetailPage resourceId={resourceId} section="scopes" />
}
