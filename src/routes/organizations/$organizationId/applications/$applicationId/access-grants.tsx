import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute('/organizations/$organizationId/applications/$applicationId/access-grants')({
  component: OrganizationApplicationAccessGrantsRoute,
})

function OrganizationApplicationAccessGrantsRoute() {
  const { applicationId, organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={
        <ApplicationDetailPage applicationId={applicationId} organizationId={organizationId} section="access-grants" />
      }
      organizationId={organizationId}
      section="applications"
    />
  )
}
