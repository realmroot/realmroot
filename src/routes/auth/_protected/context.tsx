import { createFileRoute } from '@tanstack/react-router'
import { OAuthContextPage } from '@/features/auth/oauth-context-page'

export const Route = createFileRoute('/auth/_protected/context')({
  component: OAuthContextPage,
})
