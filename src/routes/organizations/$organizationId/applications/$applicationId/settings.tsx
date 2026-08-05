import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationDetailPage } from '@/features/console/extracted/applications/application-detail'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/applications/$applicationId/settings')({
  component: OrganizationApplicationSettingsRoute,
})

function OrganizationApplicationSettingsRoute() {
  const { applicationId, organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<ApplicationDetailPage applicationId={applicationId} section="settings" />}
        organizationId={organizationId}
        section="applications"
      />
    </ConsoleScopeProvider>
  )
}
