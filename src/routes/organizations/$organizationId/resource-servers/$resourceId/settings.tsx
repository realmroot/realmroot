import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApiResourceDetailPage } from '@/features/console/extracted/api-resources'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/resource-servers/$resourceId/settings')({
  component: OrganizationResourceServerSettingsRoute,
})

function OrganizationResourceServerSettingsRoute() {
  const { organizationId, resourceId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<ApiResourceDetailPage resourceId={resourceId} section="settings" />}
        organizationId={organizationId}
        section="resource-servers"
      />
    </ConsoleScopeProvider>
  )
}
