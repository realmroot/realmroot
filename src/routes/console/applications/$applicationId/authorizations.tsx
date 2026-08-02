import { createFileRoute } from '@tanstack/react-router'
import { ApplicationDetailPage } from '@/features/console/extracted/applications/application-detail'

export const Route = createFileRoute('/console/applications/$applicationId/authorizations')({
  component: ApplicationAuthorizationsRoute,
})

function ApplicationAuthorizationsRoute() {
  const { applicationId } = Route.useParams()
  return <ApplicationDetailPage applicationId={applicationId} section="authorizations" />
}
