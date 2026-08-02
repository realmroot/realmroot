import { createFileRoute } from '@tanstack/react-router'
import { UserDetailPage } from '@/features/console/extracted/users/user-detail'

export const Route = createFileRoute('/console/users/$userId/security')({
  component: UserSecurityRoute,
})

function UserSecurityRoute() {
  const { userId } = Route.useParams()
  return <UserDetailPage userId={userId} section="authentication" />
}
