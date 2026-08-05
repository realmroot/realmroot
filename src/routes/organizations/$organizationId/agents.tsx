import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { AgentsPage } from '@/features/console/pages/agents-page'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/agents')({ component: OrganizationAgentsRoute })

function OrganizationAgentsRoute() {
  const { organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage content={<AgentsPage />} organizationId={organizationId} section="agents" />
    </ConsoleScopeProvider>
  )
}
