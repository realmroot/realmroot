import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApiResourceDetailPage } from '@/features/resource-servers/management-resource-servers'

export const Route = createFileRoute('/organizations/$organizationId/resource-servers/$resourceId/authority')({
  component: OrganizationResourceServerAuthorityRoute,
})

function OrganizationResourceServerAuthorityRoute() {
  const { organizationId, resourceId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<ApiResourceDetailPage organizationId={organizationId} resourceId={resourceId} section="authority" />}
      organizationId={organizationId}
      section="resource-servers"
    />
  )
}
