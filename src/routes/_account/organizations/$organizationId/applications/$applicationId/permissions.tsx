import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute('/_account/organizations/$organizationId/applications/$applicationId/permissions')(
  {
    component: OrganizationApplicationPermissionsRoute,
  },
)

function OrganizationApplicationPermissionsRoute() {
  const { applicationId, organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={
        <ApplicationDetailPage applicationId={applicationId} organizationId={organizationId} section="permissions" />
      }
      organizationId={organizationId}
      section="applications"
    />
  )
}
