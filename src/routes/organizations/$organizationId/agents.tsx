import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'

export const Route = createFileRoute('/organizations/$organizationId/agents')({ component: OrganizationAgentsRoute })

function OrganizationAgentsRoute() {
  const { organizationId } = Route.useParams()
  return <AccountOrganizationDetailPage organizationId={organizationId} section="agents" />
}
