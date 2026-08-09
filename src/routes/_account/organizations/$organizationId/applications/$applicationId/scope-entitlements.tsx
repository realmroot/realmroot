import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute(
  '/_account/organizations/$organizationId/applications/$applicationId/scope-entitlements',
)({
  component: OrganizationApplicationScopeEntitlementsRoute,
})

function OrganizationApplicationScopeEntitlementsRoute() {
  const { applicationId, organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={
        <ApplicationDetailPage
          applicationId={applicationId}
          organizationId={organizationId}
          section="scope-entitlements"
        />
      }
      organizationId={organizationId}
      section="applications"
    />
  )
}
