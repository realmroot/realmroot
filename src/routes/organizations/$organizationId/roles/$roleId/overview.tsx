import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { RoleDetailPage } from '@/features/console/extracted/roles'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/roles/$roleId/overview')({
  component: OrganizationRoleOverviewRoute,
})

function OrganizationRoleOverviewRoute() {
  const { organizationId, roleId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<RoleDetailPage roleId={roleId} section="overview" />}
        organizationId={organizationId}
        section="roles"
      />
    </ConsoleScopeProvider>
  )
}
