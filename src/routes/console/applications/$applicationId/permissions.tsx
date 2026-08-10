import { createFileRoute } from '@tanstack/react-router'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute('/console/applications/$applicationId/permissions')({
  component: ApplicationAccessGrantsRoute,
})

function ApplicationAccessGrantsRoute() {
  const { applicationId } = Route.useParams()
  return <ApplicationDetailPage applicationId={applicationId} section="permissions" />
}
