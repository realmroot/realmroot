import { createFileRoute } from '@tanstack/react-router'
import { AccountOrganizationDetailPage } from '@/features/account/account-center'
import { WebhooksPage } from '@/features/webhooks/management-webhooks'

export const Route = createFileRoute('/organizations/$organizationId/webhooks/endpoints')({
  component: OrganizationWebhookEndpointsRoute,
})

function OrganizationWebhookEndpointsRoute() {
  const { organizationId } = Route.useParams()
  return (
    <AccountOrganizationDetailPage
      content={<WebhooksPage organizationId={organizationId} realmOperator={false} section="endpoints" />}
      organizationId={organizationId}
      section="webhooks"
    />
  )
}
