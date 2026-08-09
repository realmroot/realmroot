import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute('/_account/organizations/$organizationId/applications/$applicationId/overview')({
  component: OrganizationApplicationOverviewRoute,
})

function OrganizationApplicationOverviewRoute() {
  const { applicationId, organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={
        <ApplicationDetailPage applicationId={applicationId} organizationId={organizationId} section="overview" />
      }
      organizationId={organizationId}
      section="applications"
    />
  )
}
