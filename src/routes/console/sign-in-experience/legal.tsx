import { createFileRoute } from '@tanstack/react-router'
import { ExperiencePage } from '@/features/console/extracted/branding-content/branding'

export const Route = createFileRoute('/console/sign-in-experience/legal')({ component: ExperienceLegalRoute })

function ExperienceLegalRoute() {
  return <ExperiencePage section="legal" />
}
