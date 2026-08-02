import { createFileRoute } from '@tanstack/react-router'
import { UserDetailPage } from '@/features/console/extracted/users/user-detail'

export const Route = createFileRoute('/console/users/$userId/sessions')({
  component: UserSessionsRoute,
})

function UserSessionsRoute() {
  const { userId } = Route.useParams()
  return <UserDetailPage userId={userId} section="sessions" />
}
