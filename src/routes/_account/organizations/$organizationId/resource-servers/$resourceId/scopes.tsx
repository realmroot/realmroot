import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApiResourceDetailPage } from '@/features/resource-servers/management-resource-servers'

export const Route = createFileRoute('/_account/organizations/$organizationId/resource-servers/$resourceId/scopes')({
  component: OrganizationResourceServerScopesRoute,
})

function OrganizationResourceServerScopesRoute() {
  const { organizationId, resourceId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<ApiResourceDetailPage organizationId={organizationId} resourceId={resourceId} section="scopes" />}
      organizationId={organizationId}
      section="resource-servers"
    />
  )
}
