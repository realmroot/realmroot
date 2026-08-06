import { createFileRoute } from '@tanstack/react-router'
import { WebhooksPage } from '@/features/webhooks/management-webhooks'

export const Route = createFileRoute('/console/webhooks/endpoints')({
  component: () => <WebhooksPage section="endpoints" />,
})
