import { createFileRoute } from '@tanstack/react-router'
import { RoleDetailPage } from '@/features/console/extracted/roles'

export const Route = createFileRoute('/console/roles/$roleId/scopes')({
  component: RoleScopesRoute,
})

function RoleScopesRoute() {
  const { roleId } = Route.useParams()
  return <RoleDetailPage roleId={roleId} section="scopes" />
}
