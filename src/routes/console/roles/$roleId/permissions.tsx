import { createFileRoute } from '@tanstack/react-router'
import { RoleDetailPage } from '@/features/console/extracted/roles'

export const Route = createFileRoute('/console/roles/$roleId/permissions')({ component: RolePermissionsRoute })

function RolePermissionsRoute() {
  const { roleId } = Route.useParams()
  return <RoleDetailPage roleId={roleId} section="permissions" />
}
