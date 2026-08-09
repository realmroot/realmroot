import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { OrganizationActivityPage } from '@/features/organizations/organization-activity'

export const Route = createFileRoute('/_account/organizations/$organizationId/activity')({
  component: OrganizationActivityRoute,
})

function OrganizationActivityRoute() {
  const { organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<OrganizationActivityPage organizationId={organizationId} />}
      organizationId={organizationId}
      section="activity"
    />
  )
}
