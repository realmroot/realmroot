import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { RolesPage } from '@/features/console/extracted/roles'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/roles')({ component: OrganizationRolesRoute })

function OrganizationRolesRoute() {
  const { organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage content={<RolesPage />} organizationId={organizationId} section="roles" />
    </ConsoleScopeProvider>
  )
}
