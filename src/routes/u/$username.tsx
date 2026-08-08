import { createFileRoute } from '@tanstack/react-router'
import { PublicUserProfilePage } from '@/features/public-profiles/public-profile-page'

export const Route = createFileRoute('/u/$username')({
  component: () => <PublicUserProfilePage username={Route.useParams().username} />,
})
