import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { RoleDetailPage } from '@/features/console/extracted/roles'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/roles/$roleId/permissions')({
  component: OrganizationRolePermissionsRoute,
})

function OrganizationRolePermissionsRoute() {
  const { organizationId, roleId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<RoleDetailPage roleId={roleId} section="permissions" />}
        organizationId={organizationId}
        section="roles"
      />
    </ConsoleScopeProvider>
  )
}
