import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'

export const Route = createFileRoute('/_account/organizations/$organizationId/teams')({
  component: OrganizationTeamsRoute,
})

function OrganizationTeamsRoute() {
  const { organizationId } = Route.useParams()
  return <AccountOrganizationDetailPage organizationId={organizationId} section="teams" />
}
