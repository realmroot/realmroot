import { createFileRoute } from '@tanstack/react-router'
import { ApplicationsPage } from '@/features/applications/management/applications-list'

export const Route = createFileRoute('/console/applications/')({
  component: ApplicationsRoute,
})

function ApplicationsRoute() {
  return <ApplicationsPage />
}
