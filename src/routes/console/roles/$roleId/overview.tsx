import { createFileRoute } from '@tanstack/react-router'
import { RoleDetailPage } from '@/features/console/extracted/roles'

export const Route = createFileRoute('/console/roles/$roleId/overview')({ component: RoleOverviewRoute })

function RoleOverviewRoute() {
  const { roleId } = Route.useParams()
  return <RoleDetailPage roleId={roleId} section="overview" />
}
