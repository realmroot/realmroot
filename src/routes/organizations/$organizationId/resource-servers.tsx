import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApiResourcesPage } from '@/features/console/extracted/api-resources'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/resource-servers')({
  component: OrganizationResourceServersRoute,
})

function OrganizationResourceServersRoute() {
  const { organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<ApiResourcesPage />}
        organizationId={organizationId}
        section="resource-servers"
      />
    </ConsoleScopeProvider>
  )
}
