import { createFileRoute } from '@tanstack/react-router'
import { UserDetailPage } from '@/features/console/extracted/users/user-detail'

export const Route = createFileRoute('/console/users/$userId/operations')({
  component: UserOperationsRoute,
})

function UserOperationsRoute() {
  const { userId } = Route.useParams()
  return <UserDetailPage userId={userId} section="settings" />
}
