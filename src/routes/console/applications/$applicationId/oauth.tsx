import { createFileRoute } from '@tanstack/react-router'
import { ApplicationDetailPage } from '@/features/applications/management/application-detail'

export const Route = createFileRoute('/console/applications/$applicationId/oauth')({ component: ApplicationOAuthRoute })

function ApplicationOAuthRoute() {
  const { applicationId } = Route.useParams()
  return <ApplicationDetailPage applicationId={applicationId} section="oauth" />
}
