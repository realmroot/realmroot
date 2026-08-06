import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApplicationsPage } from '@/features/applications/management/applications-list'

export const Route = createFileRoute('/organizations/$organizationId/applications')({
  component: OrganizationApplicationsRoute,
})

function OrganizationApplicationsRoute() {
  const { organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<ApplicationsPage organizationId={organizationId} />}
      organizationId={organizationId}
      section="applications"
    />
  )
}
