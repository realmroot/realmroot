import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { AgentsPage } from '@/features/agents/management-agents-page'

export const Route = createFileRoute('/organizations/$organizationId/agents')({ component: OrganizationAgentsRoute })

function OrganizationAgentsRoute() {
  const { organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<AgentsPage organizationId={organizationId} />}
      organizationId={organizationId}
      section="agents"
    />
  )
}
