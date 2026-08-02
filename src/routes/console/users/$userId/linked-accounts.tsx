import { createFileRoute } from '@tanstack/react-router'
import { UserDetailPage } from '@/features/console/extracted/users/user-detail'

export const Route = createFileRoute('/console/users/$userId/linked-accounts')({
  component: UserLinkedAccountsRoute,
})

function UserLinkedAccountsRoute() {
  const { userId } = Route.useParams()
  return <UserDetailPage userId={userId} section="authentication" />
}
