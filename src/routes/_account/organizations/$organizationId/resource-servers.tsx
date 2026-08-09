import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { ApiResourcesPage } from '@/features/resource-servers/management-resource-servers'

export const Route = createFileRoute('/_account/organizations/$organizationId/resource-servers')({
  component: OrganizationResourceServersRoute,
})

function OrganizationResourceServersRoute() {
  const { organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<ApiResourcesPage organizationId={organizationId} />}
      organizationId={organizationId}
      section="resource-servers"
    />
  )
}
