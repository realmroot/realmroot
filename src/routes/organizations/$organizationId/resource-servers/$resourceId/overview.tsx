import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApiResourceDetailPage } from '@/features/resource-servers/management-resource-servers'

export const Route = createFileRoute('/organizations/$organizationId/resource-servers/$resourceId/overview')({
  component: OrganizationResourceServerOverviewRoute,
})

function OrganizationResourceServerOverviewRoute() {
  const { organizationId, resourceId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<ApiResourceDetailPage organizationId={organizationId} resourceId={resourceId} section="overview" />}
      organizationId={organizationId}
      section="resource-servers"
    />
  )
}
