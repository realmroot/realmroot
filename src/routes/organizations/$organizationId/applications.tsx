import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationsPage } from '@/features/console/extracted/applications/applications-list'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/applications')({
  component: OrganizationApplicationsRoute,
})

function OrganizationApplicationsRoute() {
  const { organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<ApplicationsPage />}
        organizationId={organizationId}
        section="applications"
      />
    </ConsoleScopeProvider>
  )
}
