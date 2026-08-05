import { createFileRoute } from '@tanstack/react-router'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute('/console/applications/$applicationId/overview')({
  component: ApplicationOverviewRoute,
})

function ApplicationOverviewRoute() {
  const { applicationId } = Route.useParams()
  return <ApplicationDetailPage applicationId={applicationId} section="overview" />
}
