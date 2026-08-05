import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { WebhooksPage } from '@/features/console/extracted/deployment-misc/webhooks'
import { ConsoleScopeProvider } from '@/lib/console-context'

export const Route = createFileRoute('/organizations/$organizationId/webhooks/endpoints')({
  component: OrganizationWebhookEndpointsRoute,
})

function OrganizationWebhookEndpointsRoute() {
  const { organizationId } = Route.useParams()
  return (
    <ConsoleScopeProvider value={{ organizationId, realmOperator: false }}>
      <AccountOrganizationDetailPage
        content={<WebhooksPage section="endpoints" />}
        organizationId={organizationId}
        section="webhooks"
      />
    </ConsoleScopeProvider>
  )
}
