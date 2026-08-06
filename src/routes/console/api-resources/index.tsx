import { createFileRoute } from '@tanstack/react-router'
import { ApiResourcesPage } from '@/features/resource-servers/management-resource-servers'

export const Route = createFileRoute('/console/api-resources/')({
  component: ApiResourcesPage,
})
