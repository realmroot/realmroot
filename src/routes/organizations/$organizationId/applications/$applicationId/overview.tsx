import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationDetailPage } from '@/features/console/extracted/applications/application-detail'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/applications/$applicationId/overview')({
  component: OrganizationApplicationOverviewRoute,
})

function OrganizationApplicationOverviewRoute() {
  const { applicationId, organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<ApplicationDetailPage applicationId={applicationId} section="overview" />}
        organizationId={organizationId}
        section="applications"
      />
    </ConsoleScopeProvider>
  )
}
