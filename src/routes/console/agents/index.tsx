import { createFileRoute } from '@tanstack/react-router'
import { AgentsPage } from '@/features/console/pages/agents-page'

export const Route = createFileRoute('/console/agents/')({
  component: AgentsPage,
})
