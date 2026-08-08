import { createFileRoute } from '@tanstack/react-router'
import { PublicAgentProfilePage } from '@/features/public-profiles/public-profile-page'

export const Route = createFileRoute('/agents_/$subject')({
  component: () => <PublicAgentProfilePage subject={Route.useParams().subject} />,
})
